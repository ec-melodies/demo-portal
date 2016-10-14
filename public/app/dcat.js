import {promises as jsonld} from 'jsonld'
import {loadJSON} from './util.js'

const DCAT_CONTEXT = [
  // unmodified copy of https://ec-melodies.github.io/wp02-dcat/context.jsonld
  // Note: This has to be kept in sync when changes are made to the context!
  // We embed the context here directly to save a network request.
  {
    "@language": "en",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "dcat": "http://www.w3.org/ns/dcat#",
    "dct": "http://purl.org/dc/terms/",
    "locn": "http://www.w3.org/ns/locn#",
    "foaf": "http://xmlns.com/foaf/0.1/",
    "schema": "http://schema.org/",
    "label": "http://www.w3.org/2000/01/rdf-schema#label",
    "Catalog": "dcat:Catalog",
    "datasets": {"@id": "dcat:dataset", "@container": "@set"},
    "Dataset": "dcat:Dataset",
    "Location": "dct:Location",
    "geometry": { "@id": "locn:geometry", "@type": "gsp:wktLiteral" },
    "gsp": "http://www.opengis.net/ont/geosparql#",
    "PeriodOfTime": "dct:PeriodOfTime",
    "startDate": { "@id": "schema:startDate", "@type": "xsd:dateTime" },
    "endDate": { "@id": "schema:endDate", "@type": "xsd:dateTime" },
    "title": { "@id": "dct:title", "@container": "@language" },
    "description": { "@id": "dct:description", "@container": "@language" },
    "theme": { "@id": "dcat:theme", "@type": "@id" },
    "issued": { "@id": "dct:issued", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
    "modified": { "@id": "dct:modified", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
    "landingPage": { "@id": "dcat:landingPage", "@type": "@id" },
    "homepage": { "@id": "foaf:homepage", "@type": "@id" },
    "spatial": "dct:spatial",
    "temporal": "dct:temporal",
    "keywords": {"@id": "dcat:keyword", "@container": "@set"},
    "ssn": "http://purl.oclc.org/NET/ssnx/ssn#",
    "observedProperties": { "@id": "ssn:observedProperty", "@type": "@id", "@container": "@set" },
    "publisher": "dct:publisher",
    "Organization": "foaf:Organization",
    "Group": "foaf:Group",
    "name": {"@id": "foaf:name", "@language": null},
    "Distribution": "dcat:Distribution",
    "distributions": {"@id": "dcat:distribution", "@container": "@set"},
    "accessURL": { "@id": "dcat:accessURL", "@type": "@id" },
    "downloadURL": { "@id": "dcat:downloadURL", "@type": "@id" },
    "mediaType": {"@id": "dcat:mediaType", "@language": null},
    "format": {"@id": "dct:format", "@language": null},
    "isPartOf": { "@id": "dct:isPartOf", "@type": "@id" },
    "parts": { "@id": "dct:hasPart", "@type": "@id", "@container": "@set" }
  },
  
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
    "@language": null,
    "title": { "@id": "dct:title" },
    "description": { "@id": "dct:description" },
    "title_i18n": { "@id": "dct:title", "@container": "@language" },
    "description_i18n": { "@id": "dct:description", "@container": "@language" },
    "@base": null,
    "id": "@id"
  }
]

const DCAT_CATALOG_FRAME = {
    "@context": DCAT_CONTEXT,
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

const DCAT_DATASET_FRAME = {
    "@context": DCAT_CONTEXT,
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

/**
 * Load a DCAT catalog or a single dataset and return the unmodified
 * JSON-LD source, the frame, and the framed&compacted JSON-LD.
 */
export function loadDCATCatalog (url) {
  return loadJSON(url, ['application/ld+json']).then(raw => {
    return jsonld.frame(raw, DCAT_CATALOG_FRAME)
      .then(framed => jsonld.compact(framed, framed['@context']))
      .then(compacted => {
        if (compacted['@type'] === 'Catalog') {
          return {compacted, raw, frame: DCAT_CATALOG_FRAME}
        } else {
          // we may have a single Dataset here, so we'll try to frame for that
          return jsonld.frame(url, DCAT_DATASET_FRAME)
            .then(framed => jsonld.compact(framed, framed['@context']))
            .then(compacted => {
              if (compacted['@type'] !== 'Dataset') {
                throw new Error('No DCAT data found')
              }
              return {compacted, raw, frame: DCAT_DATASET_FRAME}
            })
        }
      })
  })
}

/**
 * Load a DCAT catalog or a single dataset that we wrap into a catalog
 * and apply some transformations to the catalog data for further use.
 * The applied changes are CKAN repairs and language map creation.
 */
export function loadCatalog (url) {
  return loadDCATCatalog(url)
    .then(({compacted}) => {
      let catalog
      if (compacted['@type'] === 'Catalog') {
        catalog = compacted
      } else /*if (compacted['@type'] === 'Dataset')*/ {
        catalog = {
          datasets: [compacted]
        }
      }
      
      // We create our own preferred structure:
      // title/description is always a language map where an untagged string is stored under the "unknown"
      // language key. This is not possible with JSON-LD framing alone.
      for (let dataset of catalog.datasets) {
        for (let key of ['title', 'description']) {
          transform_i18n(dataset, key)
        }
        for (let dist of dataset.distributions) {
          for (let key of ['title', 'description']) {
            transform_i18n(dist, key)
          }
          // repair CKAN data a bit...
          if (!dist.mediaType) {
            if (dist.format.toLowerCase() === 'geojson') {
              dist.mediaType = 'application/vnd.geo+json'
            }
            if (dist.format.toLowerCase() === 'wms') {
              // this doesn't actually exist, but wms endpoints would deliver application/xml which doesn't say much
              dist.mediaType = 'application/wms+xml'
            }
          }
          // TODO remove once ckanext-dcat is fixed (properties are of string instead of resource type)
          if (dist['dcat:downloadURL']) {
            dist.downloadURL = dist['dcat:downloadURL']
          }
          if (dist['dcat:accessURL']) {
            dist.accessURL = dist['dcat:accessURL']
          }
          // convenience
          dist.url = dist.downloadURL || dist.accessURL
        }
      }
      // since this is not a valid JSON-LD doc anymore, we might as well remove the context now
      delete catalog['@context']
      return catalog
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
    let map = {}
    for (let lang in obj[key + i18n]) {
      map[lang] = obj[key + i18n][lang]
    }
    obj[key] = map
    delete obj[key + i18n]
  }
}
