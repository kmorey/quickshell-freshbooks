const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

test('declares one installable service plus bar-widget plugin', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.id, 'kmorey.freshbooks-time')
  assert.deepEqual(manifest.kinds, ['service', 'bar-widget'])
  assert.equal(manifest.keepLoaded, true)
  assert.equal(manifest.entryPoints.service, 'Service.qml')
  assert.equal(manifest.entryPoints.barWidget, 'BarWidget.qml')
  assert.equal(manifest.barWidget.allowMultiple, false)
  assert.equal(manifest.barWidget.defaultSection, 'right')
})

test('uses the generic third-party service lookup compatibility seam', () => {
  const access = fs.readFileSync(path.join(root, 'ServiceAccess.js'), 'utf8')
  const widget = fs.readFileSync(path.join(root, 'BarWidget.qml'), 'utf8')
  assert.match(access, /shell\.serviceFor/)
  assert.doesNotMatch(access + widget, /firstPartyServiceFor/)
  assert.match(widget, /ServiceAccess\.serviceFor/)
  assert.match(widget, /openCalendar/)
  assert.match(widget, /boundedStatus/)
  assert.match(widget, /panelLoaded:/)
  assert.match(widget, /if \(!activeTimer\) return ""/)
  assert.doesNotMatch(widget, /return "FreshBooks"/)
  assert.doesNotMatch(widget, /activeTimer\.note/)
})

test('keeps FreshBooks invocation as an argv array with no command shell', () => {
  const adapter = fs.readFileSync(path.join(root, 'CliAdapter.qml'), 'utf8')
  assert.match(adapter, /\[executable\]\.concat\(argv\)\.concat\(\["--json"\]\)/)
  assert.doesNotMatch(adapter, /sh",\s*"-c|bash",\s*"-c/)
  assert.match(adapter, /CLI_TIMEOUT/)
  assert.match(adapter, /INVALID_JSON/)
  assert.match(adapter, /CLI_SCHEMA_MISMATCH/)
  assert.match(adapter, /CLI_RESPONSE_TOO_LARGE/)
  assert.match(adapter, /CLI_SIGNAL/)
  assert.match(adapter, /CLI_RECORD_SCHEMA_MISMATCH/)
  assert.match(adapter, /maxResponseBytes: 1048576/)
  assert.match(adapter, /schemaVersion !== 1/)
})

test('imports Quickshell.Io wherever IO types are instantiated', () => {
  const service = fs.readFileSync(path.join(root, 'Service.qml'), 'utf8')
  const widget = fs.readFileSync(path.join(root, 'BarWidget.qml'), 'utf8')
  assert.match(service, /^import Quickshell\.Io$/m)
  assert.match(widget, /^import Quickshell\.Io$/m)
  assert.ok(widget.includes(String.fromCodePoint(0xf051b)))
  assert.ok(!widget.includes(String.fromCodePoint(0xf1442)))
  assert.match(widget, /hasVisualContent:\s*root\.vertical\s*\|\|\s*text\s*!==\s*""/)
})

test('exposes one deep intent module and an injectable deterministic adapter', () => {
  const service = fs.readFileSync(path.join(root, 'Service.qml'), 'utf8')
  for (const intent of [
    'refresh',
    'start',
    'pause',
    'resume',
    'correctDuration',
    'updateTimerNote',
    'logTimer',
    'switchTimer',
    'createEntry',
    'updateEntry',
    'deleteEntry'
  ]) assert.match(service, new RegExp(`function ${intent}\\(`))
  assert.match(service, /property var cliAdapter: productionCli/)
  assert.match(service, /function useAdapter\(adapter\)/)
  assert.equal((service.match(/CliAdapter\s*\{/g) || []).length, 1)
  assert.match(service, /Quickshell\.statePath\("kmorey\.freshbooks-time-drafts\.json"\)/)
  assert.match(service, /atomicWrites: true/)
  assert.match(service, /property int schemaVersion: 2/)
  assert.match(service, /mutation === true && \(outcomeUnknown \|\| conflictPending\)/)
  assert.match(service, /clearTimerNoteDraft/)
  assert.match(service, /clearTimerDurationDraft/)
  assert.match(service, /refreshRecentEntries/)
  assert.match(service, /--limit", "200/)
  assert.match(service, /Quickshell\.cachePath\("kmorey\.freshbooks-time-cache\.json"\)/)
  assert.match(service, /refreshDiagnostics/)
  assert.match(service, /prepareCreateEntry/)
  assert.match(service, /knownEntryDate/)
  assert.match(service, /_unknownRefreshFrom/)
  assert.match(service, /function retryUnknownRefresh/)
  assert.match(service, /freshbooks-time-drafts\.incompatible\.json/)
  assert.match(service, /JSON\.parse\(rawDraft\)/)
  assert.match(service, /_draftFileReady\) writeAdapter/)
  assert.match(service, /onSaved: root\.finishDraftReset/)
  assert.match(service, /onSaveFailed: function\(error\)/)
  assert.match(service, /original file was left untouched/)
  assert.doesNotMatch(service, /Qt\.resolvedUrl\([^)]*draft/i)
})

test('ships timer, project, and calendar workflows in one keyboard panel', () => {
  const panel = fs.readFileSync(path.join(root, 'Panel.qml'), 'utf8')
  for (const tab of ['timer', 'projects', 'calendar']) assert.match(panel, new RegExp(`"${tab}"`))
  assert.match(panel, /KeyboardPanel/)
  assert.match(panel, /centerOnBar:\s*false/)
  assert.match(panel, /parseDurationInput/)
  assert.match(panel, /reportingWeekTotal/)
  assert.match(panel, /switchTimer/)
  assert.match(panel, /registerVisibleConsumer/)
  assert.match(panel, /beginAddEntry/)
  assert.match(panel, /beginEditEntry/)
  assert.match(panel, /createEntry/)
  assert.match(panel, /updateEntry/)
  assert.match(panel, /deleteEntry/)
  assert.match(panel, /confirmingDelete/)
  assert.match(panel, /projectShortcuts/)
  assert.match(panel, /Apply mine/)
  assert.match(panel, /resolveConflictReload/)
  assert.match(panel, /resolveConflictApplyMine/)
  assert.match(panel, /sameShortcut/)
  assert.match(panel, /timeTracking\.pause\(\)/)
  assert.match(panel, /onMoveRequested/)
  assert.match(panel, /onActivateRequested/)
  assert.match(panel, /entryDateField/)
  assert.match(panel, /property int cursorIndex/)
  assert.match(panel, /onContainsMouseChanged/)
  assert.doesNotMatch(panel, /\};\s*on[A-Z]/)
  const durationEditor = panel.slice(panel.indexOf('id: durationField'), panel.indexOf('Row {', panel.indexOf('id: durationField')))
  assert.doesNotMatch(durationEditor, /onAccepted:/)
  assert.match(panel, /draftTimerDurationDirty/)
})
