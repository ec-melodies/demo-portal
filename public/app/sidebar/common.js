// maps short format identifiers to media types
export const MediaTypes = {
    CovJSON: ['application/prs.coverage+json', 'application/prs.coverage+cbor'],
    netCDF: ['application/x-netcdf'],
    GeoJSON: ['application/vnd.geo+json']
}
/** Formats we can visualize on a map */
export const MappableFormats = new Set(['WMS', 'GeoJSON', 'CovJSON'])

/** Formats we can do data processing on */
export const DataFormats = new Set(['GeoJSON', 'CovJSON'])

/** Short label for media types that CKAN doesn't know (otherwise we can use .format) */
export function getDistFormat (dist) {
  let formatOrMediaType = dist.format ? dist.format : dist.mediaType
  if (!formatOrMediaType) {
    return 'generic'
  }
  for (let key in MediaTypes) {
    if (MediaTypes[key].indexOf(formatOrMediaType) !== -1) {
      return key
    }
  }
  return formatOrMediaType
}