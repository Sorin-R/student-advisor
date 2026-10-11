// Apply the saved theme before the page paints; kept external for the site's CSP.
;(function () {
  var theme
  try { theme = localStorage.getItem('student_advisor_theme') } catch (_) { /* Storage can be disabled. */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
})()
