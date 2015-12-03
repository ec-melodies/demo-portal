import {$, HTML} from 'minified'

import {i18n, fromTemplate} from '../util.js'

let paneHtml = () => `
<h1 class="sidebar-header">Analyse<div class="sidebar-close"><i class="glyphicon glyphicon-menu-left"></i></div></h1>

<div class="analysis-dataset-list"></div>
`

let templatesHtml = `
<template id="template-analysis-dataset">
  <div class="panel panel-default analysis-dataset">
    <div class="panel-heading">
      <h4>
        <span class="dataset-title"></span>
        <button type="button" class="close" aria-label="Close"><span aria-hidden="true">&times;</span></button>
      </h4>
    </div>
    <div class="panel-body" style="text-align: center">
      <div class="throbber-loader loader">Loading...</div>
    </div>
  
    <ul class="list-group analysis-dataset-distribution-list"></ul>
  </div>
</template>
<template id="template-analysis-dataset-distribution">
  <li class="list-group-item analysis-dataset-distribution">
    <p class="distribution-format"></p>
    <p class="distribution-metadata"></p>
  </li>
</template>
<template id="template-analysis-dataset-distribution-error">
<li class="list-group-item analysis-dataset-distribution">
  <p>Format: <span class="distribution-format"></span></p>
  <p>Error: <span class="distribution-loading-error"></span></p>
  <p>Source: <span class="distribution-source"></span></p>
</li>
</template>

<style>
.distribution-source {
  word-wrap: break-word;
}
.analysis-dataset-list {
  margin-top: 20px;
}
@keyframes flash-icon {
  0%   {color: black}
  50%  {color: red}
  100% {color: black}
}
.highlight-anim {
  animation-name: flash-icon;
  animation-duration: 0.8s;
  animation-iteration-count: 4;
  animation-timing-function: ease-in-out;
}
/* http://www.css-spinners.com/spinner/throbber */
@keyframes throbber-loader {
  0% {
    background: #dde2e7;
  }
  10% {
    background: #6b9dc8;
  }
  40% {
    background: #dde2e7;
  }
}
/* :not(:required) hides these rules from IE9 and below */
.throbber-loader:not(:required) {
  animation: throbber-loader 2000ms 300ms infinite ease-out;
  background: #dde2e7;
  display: inline-block;
  position: relative;
  text-indent: -9999px;
  width: 0.9em;
  height: 1.5em;
  margin: 0 1.6em;
}
.throbber-loader:not(:required):before, .throbber-loader:not(:required):after {
  background: #dde2e7;
  content: '\x200B';
  display: inline-block;
  width: 0.9em;
  height: 1.5em;
  position: absolute;
  top: 0;
}
.throbber-loader:not(:required):before {
  animation: throbber-loader 2000ms 150ms infinite ease-out;
  left: -1.6em;
}
.throbber-loader:not(:required):after {
  animation: throbber-loader 2000ms 450ms infinite ease-out;
  right: -1.6em;
}
</style>
`
$('body').add(HTML(templatesHtml))

export default class AnalysePane {
  constructor (sidebar, paneId) {
    this.sidebar = sidebar
    this.id = paneId
    
    $('#' + paneId).fill(HTML(paneHtml()))
    
    this.analysisCatalogue = sidebar.analysisCatalogue
    
    this._registerModelListeners()
  }
  
  _registerModelListeners () {
    this.analysisCatalogue.on('add', ({dataset}) => {
      let tab = $('a.sidebar-tab', '#' + this.sidebar.id).filter(t => $(t).get('@href') === '#' + this.id)
      tab.set('-highlight-anim')
      setTimeout(() => { // doesn't work without small delay
        tab.set('+highlight-anim')
      }, 100)
      
      this._addDataset(dataset)
    })
    
    this.analysisCatalogue.on('remove', ({dataset}) => {
      $(dataset.domEl).remove()
    })
    
    this.analysisCatalogue.on('distributionsMetadataLoading', ({dataset}) => {
      $('.panel-body', dataset.domEl).show()
    })
    
    this.analysisCatalogue.on('distributionsMetadataLoad', ({dataset}) => {
      $('.panel-body', dataset.domEl).hide()
    })
    
    this.analysisCatalogue.on('distributionMetadataLoad', ({dataset, distribution}) => {
      this._addDistribution(dataset, distribution)
    })
    
    this.analysisCatalogue.on('distributionMetadataLoadError', ({dataset, distribution, error}) => {
      this._addDistributionLoadError(dataset, distribution, error)
    })
  }
  
  _addDataset (dataset) {
    let el = fromTemplate('template-analysis-dataset')
    $('.analysis-dataset-list', '#' + this.id).add(el)
    dataset.domEl = el
    
    let title = i18n(dataset.title)
    $('.dataset-title', el).fill(title)
    
    $('.close', el).on('click', () => {
      this.analysisCatalogue.removeDataset(dataset)
    })
  }
  
  _addDistribution (dataset, distribution) {
    let el = fromTemplate('template-analysis-dataset-distribution')
    $('.analysis-dataset-distribution-list', dataset.domEl).add(el)
    distribution.domEl = el
    let meta = distribution.metadata
    
    $('.distribution-format', el).fill(meta.format)
    $('.distribution-metadata', el).fill(meta.type)
  }
  
  _addDistributionLoadError (dataset, distribution, error) {
    let el = fromTemplate('template-analysis-dataset-distribution-error')
    $('.analysis-dataset-distribution-list', dataset.domEl).add(el)
    distribution.domEl = el
    
    $('.distribution-format', el).fill(distribution.format || distribution.mediaType)
    $('.distribution-loading-error', el).fill(error.message)
    let source
    if (error.response) {
      source = error.response.url
    } else {
      source = 'local'
    }
    $('.distribution-source', el).fill(source)
  }
  
}
