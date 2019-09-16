const os = require('os')
const fs = require('fs')
const fsp = fs.promises
const request = require('request-promise-native')
const spawn = require('child_process').spawn
const joinPath = require('path').join
const uuidv4 = require('uuid/v4')
const sharp = require('sharp')
const promisify = require('util').promisify
const parseURL = require('url').parse

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
const imageURL = argv['c']
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
	if(parseURL(imageURL)){
		image = await request({
			url: imageURL,
			encoding: null
		})
	} else {

	}
	await sharp(image)
		.resize({width: 512, options: {
			withoutEnlargement: false
		}})
		.jpeg()
		.toFile(imagePath)


	// Get cd information from music brainz
	const data = await request({
		url: `https://musicbrainz.org/ws/2/release/${discId}?inc=artist-credits+labels+discids+recordings&fmt=json`,
		headers: {
			'User-Agent': 'anonymous'
		},
		json: true
	})


	// Rip disc if not set target-directory
	if(!targetDir){
		const confPath = joinPath(tempDir, 'conf')
		await fsp.writeFile(confPath, `
			CDDBMETHOD=cddb
			OUTPUTTYPE=aiff
			OUTPUTFORMAT='\${TRACKNUM} \${TRACKFILE}'
			OUTPUTDIR='${ripDir}'
		`)

		const abcde = spawn('abcde', ['-c', confPath, '-d', device, '-n', '-N', '-x'], {cwd: tempDir})
		await waitChildProcess(abcde)
	}


	// Convert and tagging files
	const tracks = data.media.find(media => media.position === discNumber).tracks.map(track => ({
		position: track.position,
		title: track.title,
		artist: joinArtistName(track['artist-credit']),
		newFilename: `${multiDisc ? discNumber.toString().padStart(2, 0) + '-' : ''}${track.position.toString().padStart(2, 0)} ${track.title.replace(/[\/\\\?*:"\|<>]/, '')}.flac`
	}))

	const targetFiles = (await fsp.readdir(ripDir)).filter(filename => /\.(wav|aiff?|flac)$/.test(filename))

	for(let filename of targetFiles){
		const trackNumber = Number(filename.match(/^\d+/)[0])
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
		const flac = spawn('flac', ['--disable-constant-subframes', '--disable-fixed-subframes', '--max-lpc-order=0', '-o', `${joinPath(outTempDir, track.newFilename)}`, `${joinPath(ripDir, filename)}`])
		await waitChildProcess(flac)

		const metaflac = spawn('metaflac', ['--remove-all-tags', ...Object.entries(tags).map(([name, value]) => `--set-tag=${name}=${value}`), `--import-picture-from`, `${joinPath(tempDir, 'cover.jpg')}`, `${joinPath(outTempDir, track.newFilename)}`])
		await waitChildProcess(metaflac)
	}


	// Move converted files to output directory
	const artistDir = joinPath(outDir, joinArtistName(data['artist-credit']))
	await fsp.mkdir(artistDir, {recursive: true})
	await fsp.rename(outTempDir, joinPath(artistDir, data.title))


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