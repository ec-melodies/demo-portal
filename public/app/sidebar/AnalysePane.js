import {$, HTML} from 'minified'

import {i18n, fromTemplate} from '../util.js'

let paneHtml = () => `
<h1 class="sidebar-header">Analyse<div class="sidebar-close"><i class="glyphicon glyphicon-menu-left"></i></div></h1>

<ul class="list-group analysis-dataset-list"></ul>
`

let templatesHtml = `
<template id="template-analysis-dataset-list-item">
  <li class="list-group-item">
    <h4 class="list-group-item-heading dataset-title"></h4>
    <p class="dataset-analysis-actions"></p>  
  </li>
</template>

<style>
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
  }
  
  _addDataset (dataset) {
    let el = fromTemplate('template-analysis-dataset-list-item')
    $('.analysis-dataset-list', '#' + this.id).add(el)
    
    let title = i18n(dataset.title)
    $('.dataset-title', el).fill(title)
    
    
    
  }
}
