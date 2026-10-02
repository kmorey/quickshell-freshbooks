import QtQuick
import Quickshell
import Quickshell.Io
import "CanonicalContract.js" as CanonicalContract
import "ProjectCacheModel.js" as ProjectCacheModel

Item {
  id: root

  property string path: Quickshell.cachePath("kmorey.freshbooks-projects.json")
  property bool ready: false
  property var pendingProjects: null

  signal loaded(var projects)

  function publishLoad(text) {
    var cached = ProjectCacheModel.deserialize(String(text || ""))
    var projects = CanonicalContract.validateMetadata("project-list", cached.projects)
      ? cached.projects : []
    ready = true
    loaded(projects)
    if (pendingProjects !== null) {
      var pending = pendingProjects
      pendingProjects = null
      save(pending)
    }
  }

  function save(projects) {
    var confirmed = Array.isArray(projects) ? projects : []
    if (!ready) {
      pendingProjects = confirmed
      return
    }
    cacheFile.setText(ProjectCacheModel.serialize(confirmed, new Date().toISOString()))
  }

  function clear() { save([]) }

  FileView {
    id: cacheFile
    path: root.path
    atomicWrites: true
    printErrors: false
    onLoaded: root.publishLoad(text())
    onLoadFailed: root.publishLoad("")
  }
}
