const os = require('os')
const fs = require('fs')
const fsp = fs.promises
const spawn = require('child_process').spawn
const joinPath = require('path').join
const resolvePath = require('path').resolve
const { v4: uuidv4 } = require('uuid')
const sharp = require('sharp')
const promisify = require('util').promisify
const parseURL = require('url').parse
const isURL = require('isurl')
const fetch = require('node-fetch');

const rimraf = promisify(require('rimraf'))

// const argv = require('yargs').argv

const argv = require('yargs')
	.option('n', {
		alias: 'disc-number',
		default: 1
	})
	.option('m', {
		alias: 'multi-disc',
		type: 'boolean',
		default: false
	})
	.option('d', {
		alias: 'device',
		requiresArg: true
	})
	.option('c', {
		alias: 'cover'
	})
	.option('o', {
		alias: 'output',
		default: process.cwd()
	})
	.option('t', {
		alias: 'target',
		default: null
	})
	.argv

const discId = argv._[0]
const discNumber = Number(argv['n']) || 1
const multiDisc = argv['m']
const device = argv['d']
const imageURI = argv['c']
const outDir = argv['o'] || process.cwd()
const targetDir = argv['t']

;(async () => {

	// Setup temporarily directory
	const tempDir = joinPath(os.tmpdir(), `rip-${uuidv4()}`)
	const ripDir = targetDir || joinPath(tempDir, 'rip')
	const outTempDir = joinPath(tempDir, 'out')

	await fsp.mkdir(ripDir, {recursive: true})
	await fsp.mkdir(outTempDir, {recursive: true})


	// Get or copy and processing cover image.
	const imagePath = joinPath(tempDir, 'cover.jpg')
	let image
	if(imageURI){
		if(/^https?:\/\//.test(imageURI)){
			image = await fetch(imageURI).then(res => res.buffer())
		} else {
			image = await fsp.readFile(resolvePath(imageURI))
		}
		await sharp(image)
			.resize({width: 512, options: {
				withoutEnlargement: false
			}})
			.jpeg()
			.toFile(imagePath)
	}

	// Get cd information from music brainz
	const data = await fetch(`https://musicbrainz.org/ws/2/release/${discId}?inc=artist-credits+labels+discids+recordings&fmt=json`,{
		headers: {
			'User-Agent': 'anonymous'
		}
	}).then(res => res.json())

	// Rip disc if not set target-directory
	if(!targetDir){
		const confPath = joinPath(tempDir, 'conf')
		await fsp.writeFile(confPath, `
			CDDBMETHOD=cddb
			OUTPUTTYPE=aiff
			OUTPUTFORMAT='\${TRACKNUM} \${TRACKFILE}'
			OUTPUTDIR='${ripDir}'
		`)

		console.log(await fsp.readdir(tempDir))

		const abcde = spawn('abcde', ['-c', confPath, '-d', device, '-n', '-N', '-x'], {cwd: tempDir, stdio: ['pipe', process.stdout, process.stdout]})
		await waitChildProcess(abcde)
	}

	// Convert and tagging files
	const tracks = data.media.find(media => media.position === discNumber).tracks.map(track => ({
		position: track.position,
		title: track.title,
		artist: joinArtistName(track['artist-credit']),
		newFilename: `${multiDisc ? discNumber.toString().padStart(2, 0) + '-' : ''}${track.position.toString().padStart(2, 0)} ${track.title.replace(/[\/\\\?*:"\|<>]/, '')}.flac`
	}))


	const albumDir = joinPath(outDir, joinArtistName(data['artist-credit']), data.title)
	await fsp.mkdir(albumDir, {recursive: true})

	const targetFiles = (await fsp.readdir(ripDir)).filter(filename => /\.(wav|aiff?|flac)$/.test(filename))
	for(let filename of targetFiles){
		console.log(filename)
		const trackNumber = /^\d+-\d+\s/.test(filename) ? Number(filename.match(/^\d+-(\d+)/)[1]) : Number(filename.match(/^\d+/)[0])
		const track = tracks.find(track => track.position === trackNumber)

		if(!track) {
			continue
			console.error(`Can not found #${trackNumber} track data.`)
		}

		const tags = { 
			ALBUM: data.title,
			ALBUMARTIST: joinArtistName(data['artist-credit']),
			ARTIST: track.artist,
			TITLE: track.title,
			DISCNUMBER: discNumber,
			TRACKNUMBER: track.position
		}
		const flac = spawn('flac', ['--disable-constant-subframes', '--disable-fixed-subframes', '--max-lpc-order=0', '-o', `${joinPath(albumDir, track.newFilename)}`, `${joinPath(ripDir, filename)}`])
		await waitChildProcess(flac)

		const metaflac = spawn('metaflac', ['--remove-all-tags', ...Object.entries(tags).map(([name, value]) => `--set-tag=${name}=${value}`), `--import-picture-from`, `${joinPath(tempDir, 'cover.jpg')}`, `${joinPath(albumDir, track.newFilename)}`])
		await waitChildProcess(metaflac)
	}

	// Remove temorarily directory
	await rimraf(tempDir)
})()

function joinArtistName(artists){
	if(artists.length < 2){
		return artists[0].name
	} else {
		return artists.map(artist => `${artist.name}${artist.joinphrase ? artist.joinphrase : ''}`).join('')
	}
}

function waitChildProcess(childProcess){
	return new Promise((resolve, reject) => {
		childProcess.on('exit', resolve)
		childProcess.on('error', reject)
	})
}