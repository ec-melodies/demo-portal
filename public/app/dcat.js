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
    .then(framed => {
      return jsonld.compact(framed, framed['@context'])
    })
}
