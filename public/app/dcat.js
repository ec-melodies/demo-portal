import {promises as jsonld} from 'jsonld'

const DCAT_CATALOG_FRAME = {
    "@context": [
      "https://rawgit.com/ec-melodies/wp02-dcat/master/context.jsonld",
      { // override since we want the GeoJSON geometry, not the WKT one
        "geometry": { 
          "@id": "locn:geometry", 
          "@type": "https://www.iana.org/assignments/media-types/application/vnd.geo+json"
        }
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
}
