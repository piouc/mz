import os from 'os'
import fsp from 'fs/promises'
import {ChildProcess, spawn} from 'child_process'
import {join as joinPath} from 'path'
import {resolve as resolvePath} from 'path'
import { v4 as uuidv4 } from 'uuid'
import sharp from 'sharp'
import fetch from 'node-fetch'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import {  ArtistCredit, DiscIdLookupPayload, Release } from './musicbrainz-api-types'
import { createHash } from 'crypto'
import inquirer from 'inquirer'
import { Response } from 'node-fetch'

const joinArtistName = (artists: ArtistCredit[]): string => {
	if(artists.length < 2){
		return artists[0]?.name ?? ''
	} else {
		return artists.map(artist => `${artist.name}${artist.joinphrase ? artist.joinphrase : ''}`).join('')
	}
}

const waitChildProcess = (childProcess: ChildProcess) => {
	return new Promise<string>((resolve, reject) => {
		const data: Buffer[] = []
		childProcess.stdout?.on('data', chunk => {
			data.push(chunk)
		})
		childProcess.stderr?.on('data', chunk => {
			console.log(chunk.toString())
		})
		childProcess.on('exit', () => resolve(Buffer.concat(data).toString()))
		childProcess.on('error', reject)
	})
}

const toByteString = (num: number, length: number) => {
	return num.toString(16).toUpperCase().padStart(length * 2, '0')
}

const expandArray = <T>(arr: T[], length: number, fill: T) =>{
	if(arr.length > length) return arr
	return [...arr, ...Array.from(Array(length - arr.length), () => fill)]
}

const tocToDiscId = (toc: string) => {

	const [trackCount, ...offsets] = toc.split(' ').map(Number)
	const leadOutTrackOffset = offsets.pop()

	if(typeof trackCount === 'undefined' || typeof leadOutTrackOffset === 'undefined') throw new Error('Toc parse error.')

	const str = [
		toByteString(1, 1),
		toByteString(trackCount, 1),
		toByteString(leadOutTrackOffset, 4),
		...expandArray(offsets, 99, 0).map(offset => toByteString(offset, 4))
	].join('')
	console.log(createHash('sha1').update(str, 'ascii').digest('base64'))
	return createHash('sha1').update(str, 'ascii').digest('base64')
		.replaceAll('+', '.')
		.replaceAll('/', '_')
		.replaceAll('=', '-')
}

const getDiscId = async (device: string) => {
	const umount = spawn('diskutil', ['umount', device])
	await waitChildProcess(umount)

	const discId = spawn('cd-discid', ['--musicbrainz', device])
	const toc = await waitChildProcess(discId)

	return await tocToDiscId(toc)
}

const getReleasesByDiscId = async (discId: string): Promise<string> => {
	const data: DiscIdLookupPayload = (await fetch(`https://musicbrainz.org/ws/2/discid/${discId}?fmt=json`).then(res => res.json())) as any
	console.log(data, console.log(discId))
	const res = await inquirer.prompt([
		{
			type: 'list',
			name: 'releaseId',
			message: 'Select release',
			choices: data.releases.map(release => ({
				name: `${release['cover-art-archive'].front ? '☑' : '☐'} ${release.title}`,
				value: release.id
			}))
		}
	])
	return res['releaseId']
}

const handleResponse = async (res: Response) => {
	if(res.status >= 300) {
		throw new Error('Bad response from server')
	}
	return res.arrayBuffer()
}


const argv = yargs(hideBin(process.argv))
	.positional('releaseId', {
		type: 'string'
	})
	.option('disc-number', {
		alias: 'n',
		default: 1
	})
	.option('multi-disc', {
		alias: 'm',
		type: 'boolean',
		default: false
	})
	.option('device', {
		alias: 'd',
		type: 'string',
		requiresArg: true
	})
	.option('cover', {
		alias: 'c',
		type: 'string'
	})
	.option('output', {
		alias: 'o',
		default: process.cwd()
	})
	.option('input', {
		alias: 'i',
		default: null
	})

const args = await argv.parse()

const device = args['device']

if(!device) {
	argv.showHelp()
	process.exit()
}

const releaseId = args._[0] || await getReleasesByDiscId(await getDiscId(device))
const discNumber = Number(args['disc-number']) || 1
const multiDisc = args['multi-disc']
const imageUri = args['cover']
const outputDir = args['output'] || process.cwd()
const inputDir = args['input']


// Setup temporarily directory
const tempDir = joinPath(os.tmpdir(), `rip-${uuidv4()}`)
const ripDir = inputDir || joinPath(tempDir, 'rip')
const outTempDir = joinPath(tempDir, 'out')

await fsp.mkdir(ripDir, {recursive: true})
await fsp.mkdir(outTempDir, {recursive: true})

console.log(releaseId)
// Get or copy and processing cover image.
const imagePath = joinPath(tempDir, 'cover.jpg')
let image: ArrayBuffer
if(imageUri){
	if(/^https?:\/\//.test(imageUri)){
		image = await fetch(imageUri).then(handleResponse)
	} else {
		image = await fsp.readFile(resolvePath(imageUri))
	}
} else {
	image = await fetch(`https://coverartarchive.org/release/${releaseId}/front`).then(handleResponse)
}

await sharp(new Uint8Array(image))
	.resize({
		width: 512,
		withoutEnlargement: false
	})
	.jpeg()
	.toFile(imagePath)

// Get cd information from music brainz
const data = await fetch(`https://musicbrainz.org/ws/2/release/${releaseId}?inc=artist-credits+labels+discids+recordings+media&fmt=json`,{
	headers: {
		'User-Agent': 'anonymous'
	}
}).then(res => res.json()) as Release

// Rip disc if not set target-directory
if(!inputDir){
	const confPath = joinPath(tempDir, 'conf')
	await fsp.writeFile(confPath, `
		CDDBMETHOD=cddb
		OUTPUTTYPE=aiff
		OUTPUTFORMAT='\${TRACKNUM} \${TRACKFILE}'
		OUTPUTDIR='${ripDir}'
	`)

	const abcde = spawn('abcde', ['-c', confPath, '-d', device, '-n', '-N', '-x'], {cwd: tempDir, stdio: ['pipe', process.stdout, process.stdout]})
	await waitChildProcess(abcde)
}

// Convert and tagging files
const tracks = data.media.find(media => media.position === discNumber)?.tracks.map(track => ({
	position: track.position,
	title: track.title,
	artist: joinArtistName(track['artist-credit']),
	newFilename: `${multiDisc ? discNumber.toString().padStart(2, '0') + '-' : ''}${track.position.toString().padStart(2, '0')} ${track.title.replace(/[\/\\\?*:"\|<>]/, '')}.flac`
})) ?? []


const albumDir = joinPath(outputDir, joinArtistName(data['artist-credit']), data.title)
await fsp.mkdir(albumDir, {recursive: true})

const targetFiles = (await fsp.readdir(ripDir)).filter(filename => /\.(wav|aiff?|flac)$/.test(filename))
for(let filename of targetFiles){
	const trackNumber = /^\d+-\d+\s/.test(filename) ? Number(filename.match(/^\d+-(\d+)/)?.[1]) : Number(filename.match(/^\d+/)?.[0])
	const track = tracks.find(track => track.position === trackNumber)

	if(!track) {
		console.error(`Can not found #${trackNumber} track data.`)
		continue
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
await fsp.rm(tempDir, {recursive: true, force: true})