import {promises as jsonld} from 'jsonld'

const DCAT_CATALOG_FRAME = {
    "@context": [
      "https://rawgit.com/ec-melodies/wp02-dcat/master/context.jsonld",
      // geometry override since we want the GeoJSON geometry, not the WKT one
      // Also, @language and title/description override is because CKAN
      // isn't giving us language-tagged strings which means that we
      // cannot create nice language maps by default.
      // To support both scenarios (with/without language tags),
      // there are two properties for each:
      // title, description - always a string with unknown language
      // title_i18n, description_i18n - always a language map
      // If a language map is given, then the simple string property probably doesn't exist.
      // If *all* DCAT feeds had language tags then we would only need the latter,
      // but for wider support, we do a little more effort.
      // Note that these dual fields get collapsed in a post-processing step, see loadCatalog(). 
      {
        "geometry": { 
          "@id": "locn:geometry", 
          "@type": "https://www.iana.org/assignments/media-types/application/vnd.geo+json"
        },
        "@language": null,
        "title": { "@id": "dct:title" },
        "description": { "@id": "dct:description" },
        "title_i18n": { "@id": "dct:title", "@container": "@language" },
        "description_i18n": { "@id": "dct:description", "@container": "@language" },
        "@base": null
      }
    ],
    "@type": "Catalog",
	  "datasets": {
	    "@type": "Dataset",
	    "isPartOf": {
	      "@embed": "@never",
	      "@omitDefault": true
	    },
	    "parts": {
	      "@embed": "@never",
	      "@omitDefault": true
	    },
	    "distributions": {}
	  }
  }

export function loadCatalog (url) {
  return jsonld.frame(url, DCAT_CATALOG_FRAME)
    .then(framed => jsonld.compact(framed, framed['@context']))
    .then(compacted => {
      // We create our own preferred structure:
      // title/description is always a language map where an untagged string is stored under the "unknown"
      // language key. This is not possible with JSON-LD framing alone.
      for (let dataset of compacted.datasets) {
        for (let key of ['title', 'description']) {
          transform_i18n(dataset, key)
        }
        for (let dist of dataset.distributions) {
          for (let key of ['title', 'description']) {
            transform_i18n(dist, key)
          }
        }
      }
      // since this is not a valid JSON-LD doc anymore, we might as well remove the context now
      delete compacted['@context']
      return compacted
    })
}

const UNKNOWN_LANG = 'unknown'
const i18n = '_i18n'

/**
 * Transforms %key% and %key%_i18n into a single %key% language map
 * where strings with unknown language get the language tag "unknown". 
 */
function transform_i18n (obj, key) {
  if (obj[key]) {
    if (!obj[key + i18n]) {
      obj[key + i18n] = {}
    }
    obj[key + i18n][UNKNOWN_LANG] = obj[key]
  }
  if (obj[key + i18n]) {
    let map = new Map()
    for (let lang in obj[key + i18n]) {
      map.set(lang, obj[key + i18n][lang])
    }
    obj[key] = map
    delete obj[key + i18n]
  }
}
