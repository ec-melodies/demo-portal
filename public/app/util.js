/**
 * Inject HTML into the DOM.
 * 
 * @param html The html to inject at the end of the body element.
 */
export function inject (html, action='append') {
  let span = document.createElement('span')
  span.innerHTML = html
  if (action === 'append') {
    document.body.appendChild(span.children[0])
  } else if (action === 'prepend') {
    document.body.insertBefore(span.children[0], document.body.firstChild)
  } else {
    throw new Error('unknown action: ' + action)
  }
}