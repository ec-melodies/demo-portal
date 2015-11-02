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
        "description_i18n": { "@id": "dct:description", "@container": "@language" }
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
	    }
	  }
  }

export function loadCatalog (url) {
  return jsonld.frame(url, DCAT_CATALOG_FRAME)
    .then(framed => jsonld.compact(framed, framed['@context']))
    .then(compacted => {
      // We restore the structure that we really want:
      // title/description is either an untranslated string or a language map.
      // This is not possible with JSON-LD framing since in general there may
      // be multiple untranslated strings or a mix of untranslated and translated.
      // But since this doesn't happen in our case, we can apply this further domain-specific
      // transformation for better ease-of-use.
      for (let dataset of compacted.datasets) {
        for (let key of ['title', 'description']) {
          transform_i18n(dataset, key)
        }
      }
      // since this is not a valid JSON-LD doc anymore, we might as well remove the context now
      delete compacted['@context']
      return compacted
    })
}

const i18n = '_i18n'
function transform_i18n (obj, key) {
  if (obj[key + i18n]) {
    let map = new Map()
    for (let lang in obj[key + i18n]) {
      map.set(lang, obj[key + i18n][lang])
    }
    obj[key] = map
    delete obj[key + i18n]
  }
}
