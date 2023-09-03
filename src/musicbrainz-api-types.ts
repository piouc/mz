export type Release = {
  "packaging-id": string
  "release-events": Event[]
  "label-info": LabelInfo[]
  country: string
  media: Media[]
  date: string
  "status-id": string
  disambiguation: string
  title: string
  barcode: string
  packaging: string
  quality: string
  "cover-art-archive": CoverArtArchive
  id: string
  "artist-credit": ArtistCredit[]
  "text-representation": TextRepresentation
  asin: any
  status: string
}

type Event = {
  area: Area
  date: string
}

type Area = {
  name: string
  disambiguation: string
  "type-id": any
  type: any
  id: string
  "sort-name": string
  "iso-3166-1-codes": string[]
}

type LabelInfo = {
  label: Label
  "catalog-number": string
}

type Label = {
  "sort-name": string
  "label-code": any
  name: string
  id: string
  type: string
  "type-id": string
  disambiguation: string
}

type Media = {
  tracks: Track[]
  format: string
  position: number
  discs: Disc[]
  "track-offset": number
  "track-count": number
  title: string
  "format-id": string
}

type Track = {
  recording: Recording
  title: string
  number: string
  position: number
  length: number
  "artist-credit": ArtistCredit[]
  id: string
}

type Recording = {
  video: boolean
  "first-release-date": string
  title: string
  id: string
  "artist-credit": ArtistCredit[]
  length: number
  disambiguation: string
}

export type ArtistCredit = {
  artist: Artist
  name: string
  joinphrase: string
}

export type Artist = {
  "sort-name": string
  id: string
  type: string
  disambiguation: string
  "type-id": string
  name: string
}

type Disc = {
  offsets: number[]
  sectors: number
  id: string
  "offset-count": number
}

type CoverArtArchive = {
  darkened: boolean
  back: boolean
  front: boolean
  artwork: boolean
  count: number
}

type TextRepresentation = {
  script: string
  language: string
}

type DiscIdLookupPayloadRelease = {
  country: string
  disambiguation: string
  date: string
  id: string
  media: Media[]
  asin: string
  packaging: any
  status: string
  title: string
  "text-representation": TextRepresentation
  quality: string
  barcode: string
  "release-events": Event[]
  "status-id": string
  "packaging-id": any
  "cover-art-archive": CoverArtArchive
}

export type DiscIdLookupPayload = {
  releases: DiscIdLookupPayloadRelease[]
  "offset-count": number
  sectors: number
  id: string
  offsets: number[]
}