import { Quillow } from './runtime.js'

// Start one theme/layout bridge. Standalone previews keep the CSS fallbacks.
if (window.parent !== window) Quillow.start()

// For optional block storage, import connect and WidgetSDKError from the same
// runtime module. See the skill's references/storage.md; connect() is separate
// from the theme bridge and requires host support. Keep local UI usable without it.

const action = document.querySelector('#action')
const status = document.querySelector('#status')

action.addEventListener('click', () => {
  const active = action.getAttribute('aria-pressed') !== 'true'

  action.setAttribute('aria-pressed', String(active))
  action.textContent = active ? 'Action complete' : 'Try action'
  status.textContent = active ? 'Example interaction activated.' : ''
})
