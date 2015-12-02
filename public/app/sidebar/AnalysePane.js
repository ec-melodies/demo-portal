import {$, HTML} from 'minified'

let paneHtml = () => `
<h1 class="sidebar-header">Analyse<div class="sidebar-close"><i class="glyphicon glyphicon-menu-left"></i></div></h1>
`

let templatesHtml = `
<template id="template-analysis-dataset-list-item">
  <li class="list-group-item">
    <h4 class="list-group-item-heading dataset-title"></h4>
    <p class="dataset-temporal"><i class="glyphicon glyphicon-time"></i> <span class="dataset-temporal-text"></span></p>
    <p class="dataset-spatial-geometry"><i class="glyphicon glyphicon-globe"></i> <span class="dataset-spatial-geometry-text"></span></p>
    <p class="dataset-analysis-actions"></p>  
  </li>
</template>

<style>
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
  }
  
  _registerModelListeners () {
    this.analysisCatalogue.on('add', ({dataset}) => {
      console.log('added ' + dataset.id + ' to analysis catalogue')
      
      let tab = $('a.sidebar-tab', '#' + this.sidebar.id).filter(t => $(t).get('@href') === '#' + this.id)
      tab.set('-highlight-anim')
      setTimeout(() => { // doesn't work without small delay
        tab.set('+highlight-anim')
      }, 100)
    })
  }
}