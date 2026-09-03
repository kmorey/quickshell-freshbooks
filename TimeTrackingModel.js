var MS_PER_DAY = 24 * 60 * 60 * 1000

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function finiteNumber(value, fallback) {
  var number = Number(value)
  return isFinite(number) ? number : fallback
}

function integerSeconds(value) {
  return Math.max(0, Math.round(finiteNumber(value, 0)))
}

function colorChannel(value) {
  return Math.max(0, Math.min(1, finiteNumber(value, 0)))
}

function normalizedColor(value) {
  value = value || {}
  return {
    r: colorChannel(value.r),
    g: colorChannel(value.g),
    b: colorChannel(value.b),
    a: value.a === undefined ? 1 : colorChannel(value.a)
  }
}

function compositeColor(over, under) {
  var foreground = normalizedColor(over)
  var background = normalizedColor(under)
  var alpha = foreground.a + background.a * (1 - foreground.a)
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha
  }
}

function linearColorChannel(value) {
  var channel = colorChannel(value)
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
}

function colorLuminance(value) {
  var color = normalizedColor(value)
  return 0.2126 * linearColorChannel(color.r)
    + 0.7152 * linearColorChannel(color.g)
    + 0.0722 * linearColorChannel(color.b)
}

function contrastRatio(first, second) {
  var firstLuminance = colorLuminance(first)
  var secondLuminance = colorLuminance(second)
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05)
}

function readableContentRole(foreground, background, fill, surfaceBackground) {
  var backgroundCandidate = compositeColor(background, { r: 0, g: 0, b: 0, a: 1 })
  var surfaceBase = compositeColor(surfaceBackground || background, backgroundCandidate)
  var surface = compositeColor(fill, surfaceBase)
  return contrastRatio(backgroundCandidate, surface) > contrastRatio(foreground, surface)
    ? "background"
    : "foreground"
}

function pad2(value) {
  var number = Math.round(Number(value))
  return (number < 10 ? "0" : "") + number
}

function dateKey(year, month, day) {
  return Math.round(Number(year)) + "-" + pad2(month) + "-" + pad2(day)
}

function parseDateKey(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""))
  if (!match) return null
  var year = Number(match[1])
  var month = Number(match[2])
  var day = Number(match[3])
  var date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return { year: year, month: month, day: day }
}

function addDays(key, amount) {
  var parsed = parseDateKey(key)
  if (!parsed) return ""
  var date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + Math.round(finiteNumber(amount, 0))))
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function sundayWeek(key) {
  var parsed = parseDateKey(key)
  if (!parsed) return { start: "", end: "", days: [] }
  var date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day))
  var start = addDays(key, -date.getUTCDay())
  var days = []
  for (var i = 0; i < 7; i++) days.push(addDays(start, i))
  return { start: start, end: days[6], days: days }
}

function calendarMonth(year, month) {
  var normalized = new Date(Date.UTC(Math.round(Number(year)), Math.round(Number(month)) - 1, 1))
  var viewYear = normalized.getUTCFullYear()
  var viewMonth = normalized.getUTCMonth() + 1
  var first = dateKey(viewYear, viewMonth, 1)
  var firstWeek = sundayWeek(first)
  var cells = []
  for (var i = 0; i < 42; i++) {
    var key = addDays(firstWeek.start, i)
    var parsed = parseDateKey(key)
    cells.push({
      key: key,
      day: parsed.day,
      inMonth: parsed.year === viewYear && parsed.month === viewMonth,
      row: Math.floor(i / 7),
      column: i % 7
    })
  }
  return cells
}

function entryDateKey(entry) {
  if (!entry) return ""
  var local = String(entry.localDate || "").slice(0, 10)
  return parseDateKey(local) ? local : ""
}

function aggregateEntries(entries) {
  var byDay = {}
  var totalSeconds = 0
  var values = asArray(entries)
  for (var i = 0; i < values.length; i++) {
    var entry = values[i] || {}
    var key = entryDateKey(entry)
    if (key === "") continue
    var seconds = integerSeconds(entry.durationSeconds !== undefined ? entry.durationSeconds : entry.duration)
    byDay[key] = integerSeconds(byDay[key]) + seconds
    totalSeconds += seconds
  }
  return { byDay: byDay, totalSeconds: totalSeconds }
}

function reportingWeekTotal(entries, selectedDateKey) {
  var week = sundayWeek(selectedDateKey)
  if (week.start === "") return 0
  var totals = aggregateEntries(entries).byDay
  var seconds = 0
  for (var i = 0; i < week.days.length; i++) seconds += integerSeconds(totals[week.days[i]])
  return seconds
}

function timerCandidates(data) {
  if (Array.isArray(data)) return data.slice()
  if (!data || typeof data !== "object") return []
  if (Array.isArray(data.timers)) return data.timers.slice()
  if (Array.isArray(data.activeTimers)) return data.activeTimers.slice()
  if (data.timer && typeof data.timer === "object") return [data.timer]
  if (data.id !== undefined && (data.running !== undefined || data.isRunning !== undefined || data.isLogged === false)) return [data]
  return []
}

function timerMode(timers) {
  var count = asArray(timers).length
  if (count === 0) return "none"
  if (count === 1) return "single"
  return "multiple"
}

function selectedTimer(timers, selectedId) {
  var values = asArray(timers)
  if (values.length === 0) return null
  var wanted = String(selectedId === undefined || selectedId === null ? "" : selectedId)
  if (wanted !== "") {
    for (var i = 0; i < values.length; i++) {
      if (String((values[i] || {}).id) === wanted) return values[i]
    }
  }
  return values.length === 1 ? values[0] : null
}

function recordSnapshotChanged(records, recordId, snapshotToken) {
  var wantedId = String(recordId === undefined || recordId === null ? "" : recordId)
  var baseline = String(snapshotToken || "")
  if (wantedId === "" || baseline === "") return false
  var values = asArray(records)
  for (var i = 0; i < values.length; i++) {
    var record = values[i] || {}
    if (String(record.id) === wantedId) return String(record.snapshotToken || "") !== baseline
  }
  return true
}

function stateProjection(snapshot, selectedTimerId) {
  var source = snapshot && typeof snapshot === "object" ? snapshot : {}
  var timers = timerCandidates(source.timers !== undefined ? source.timers : source.activeTimers)
  var entries = asArray(source.entries).slice()
  var projects = asArray(source.projects).slice()
  var activeTimer = selectedTimer(timers, selectedTimerId)
  return {
    timerMode: timerMode(timers),
    activeTimer: activeTimer,
    timerCandidates: timers,
    projects: projects,
    entries: entries,
    totals: aggregateEntries(entries)
  }
}

function timerRunning(timer) {
  if (!timer) return false
  return timer.running === true || timer.isRunning === true
}

function elapsedSeconds(timer, nowMs) {
  if (!timer) return 0
  var confirmed = integerSeconds(timer.elapsedSeconds !== undefined ? timer.elapsedSeconds : timer.durationSeconds)
  if (!timerRunning(timer)) return confirmed
  var observedAt = finiteNumber(timer.observedAtMs, NaN)
  if (!isFinite(observedAt) && timer.observedAt) observedAt = Date.parse(String(timer.observedAt))
  if (!isFinite(observedAt)) return confirmed
  var now = finiteNumber(nowMs, observedAt)
  return confirmed + Math.max(0, Math.floor((now - observedAt) / 1000))
}

function formatDuration(seconds) {
  var value = integerSeconds(seconds)
  var hours = Math.floor(value / 3600)
  var minutes = Math.floor((value % 3600) / 60)
  var remainder = value % 60
  return pad2(hours) + ":" + pad2(minutes) + ":" + pad2(remainder)
}

function formatTimerLabel(seconds) {
  var value = integerSeconds(seconds)
  var hours = Math.floor(value / 3600)
  var minutes = Math.floor((value % 3600) / 60)
  var remainder = value % 60
  if (hours === 0) return pad2(minutes) + ":" + pad2(remainder)
  return pad2(hours) + ":" + pad2(minutes) + ":" + pad2(remainder)
}

function formatHoursMinutes(seconds) {
  var totalMinutes = Math.floor(integerSeconds(seconds) / 60)
  var hours = Math.floor(totalMinutes / 60)
  var minutes = totalMinutes % 60
  return pad2(hours) + ":" + pad2(minutes)
}

function parseDurationInput(value) {
  var match = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(String(value || "").trim())
  if (!match) return null
  var hours = Number(match[1])
  var minutes = Number(match[2])
  var seconds = Number(match[3] || 0)
  if (minutes > 59 || seconds > 59) return null
  return hours * 3600 + minutes * 60 + seconds
}

function entriesForDay(entries, key) {
  return asArray(entries).filter(function(entry) { return entryDateKey(entry) === key }).sort(function(a, b) {
    return Date.parse(String(a.startedAt || a.started_at || "")) - Date.parse(String(b.startedAt || b.started_at || ""))
  })
}

function searchProjects(projects, query) {
  var needle = String(query || "").trim().toLowerCase()
  if (needle === "") return asArray(projects).slice()
  return asArray(projects).filter(function(project) {
    return projectLabel(project).toLowerCase().indexOf(needle) !== -1
  })
}

function projectShortcuts(projects) {
  var result = []
  var values = asArray(projects)
  for (var i = 0; i < values.length; i++) {
    var project = values[i] || {}
    var services = asArray(project.services)
    if (services.length === 0) {
      result.push({ project: project, projectId: project.id, serviceId: null, serviceName: "" })
      continue
    }
    for (var j = 0; j < services.length; j++) {
      result.push({
        project: project,
        projectId: project.id,
        serviceId: services[j].id,
        serviceName: String(services[j].name || "")
      })
    }
  }
  return result
}

function searchShortcuts(shortcuts, query) {
  var needle = String(query || "").trim().toLowerCase()
  if (needle === "") return asArray(shortcuts).slice()
  return asArray(shortcuts).filter(function(shortcut) {
    return (projectLabel(shortcut.project) + "\n" + String(shortcut.serviceName || "")).toLowerCase().indexOf(needle) !== -1
  })
}

function activeProject(project) {
  if (!project) return false
  return project.active !== false && project.complete !== true && project.archived !== true
}

function projectId(project) {
  return String(project && project.id !== undefined ? project.id : "")
}

function projectLabel(project) {
  if (!project) return ""
  return String(project.clientName || "") + "\n" + String(project.name || project.title || "")
}

function shortcutKey(projectValue, serviceValue) {
  var project = String(projectValue === undefined || projectValue === null ? "" : projectValue)
  var service = String(serviceValue === undefined || serviceValue === null ? "" : serviceValue)
  return project + "\n" + service
}

function shortcutLabel(shortcut) {
  return projectLabel(shortcut && shortcut.project) + "\n" + String(shortcut && shortcut.serviceName || "")
}

function recentShortcutOrder(shortcuts, entries, activeProjectId, activeServiceId) {
  var lastUsed = {}
  var values = asArray(entries)
  for (var i = 0; i < values.length; i++) {
    var entry = values[i] || {}
    var entryProjectId = entry.projectId !== undefined ? entry.projectId : entry.project_id
    if (entryProjectId === undefined || entryProjectId === null || String(entryProjectId) === "") continue
    var entryServiceId = entry.serviceId !== undefined ? entry.serviceId : entry.service_id
    var key = shortcutKey(entryProjectId, entryServiceId)
    var timestamp = Date.parse(String(entry.startedAt || entry.updatedAt || entry.started_at || entry.updated_at || ""))
    if (!isFinite(timestamp)) timestamp = 0
    if (lastUsed[key] === undefined || timestamp > lastUsed[key]) lastUsed[key] = timestamp
  }

  var activeKey = shortcutKey(activeProjectId, activeServiceId)
  var hasActiveShortcut = String(activeProjectId === undefined || activeProjectId === null ? "" : activeProjectId) !== ""
  var result = asArray(shortcuts).filter(function(shortcut) { return activeProject(shortcut && shortcut.project) })
  result.sort(function(a, b) {
    var aKey = shortcutKey(a && a.projectId, a && a.serviceId)
    var bKey = shortcutKey(b && b.projectId, b && b.serviceId)
    if (hasActiveShortcut && aKey === activeKey && bKey !== activeKey) return -1
    if (hasActiveShortcut && bKey === activeKey && aKey !== activeKey) return 1
    var recent = finiteNumber(lastUsed[bKey], 0) - finiteNumber(lastUsed[aKey], 0)
    if (recent !== 0) return recent
    return shortcutLabel(a).localeCompare(shortcutLabel(b))
  })
  return result
}

function recentProjectOrder(projects, entries, activeProjectId) {
  var lastUsed = {}
  var values = asArray(entries)
  for (var i = 0; i < values.length; i++) {
    var entry = values[i] || {}
    var id = String(entry.projectId !== undefined ? entry.projectId : "")
    if (id === "") continue
    var timestamp = Date.parse(String(entry.startedAt || entry.updatedAt || ""))
    if (!isFinite(timestamp)) timestamp = 0
    if (lastUsed[id] === undefined || timestamp > lastUsed[id]) lastUsed[id] = timestamp
  }

  var activeId = String(activeProjectId === undefined || activeProjectId === null ? "" : activeProjectId)
  var result = asArray(projects).filter(activeProject)
  result.sort(function(a, b) {
    var aId = projectId(a)
    var bId = projectId(b)
    if (aId === activeId && bId !== activeId) return -1
    if (bId === activeId && aId !== activeId) return 1
    var recent = finiteNumber(lastUsed[bId], 0) - finiteNumber(lastUsed[aId], 0)
    if (recent !== 0) return recent
    return projectLabel(a).localeCompare(projectLabel(b))
  })
  return result
}

if (typeof module !== "undefined") module.exports = {
  addDays: addDays,
  aggregateEntries: aggregateEntries,
  calendarMonth: calendarMonth,
  contrastRatio: contrastRatio,
  dateKey: dateKey,
  elapsedSeconds: elapsedSeconds,
  entryDateKey: entryDateKey,
  formatDuration: formatDuration,
  formatHoursMinutes: formatHoursMinutes,
  formatTimerLabel: formatTimerLabel,
  parseDurationInput: parseDurationInput,
  projectShortcuts: projectShortcuts,
  entriesForDay: entriesForDay,
  parseDateKey: parseDateKey,
  recentProjectOrder: recentProjectOrder,
  recentShortcutOrder: recentShortcutOrder,
  readableContentRole: readableContentRole,
  recordSnapshotChanged: recordSnapshotChanged,
  searchProjects: searchProjects,
  searchShortcuts: searchShortcuts,
  reportingWeekTotal: reportingWeekTotal,
  selectedTimer: selectedTimer,
  stateProjection: stateProjection,
  sundayWeek: sundayWeek,
  timerCandidates: timerCandidates,
  timerMode: timerMode
}
