"use strict";
/*
 * Seashell's front-end.
 * Copyright (C) 2013-2014 The Seashell Maintainers.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * See also 'ADDITIONAL TERMS' at the end of the included LICENSE file.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
var settings = null;

// variable for monitoring disconnection from websocket
var dccount = 0;

function setupDisconnectMonitor() {
  var max_disconnects = 3;

  function onReconnect() {
    if(dccount >= max_disconnects) {
      $('#disconnection-error-alert').addClass('hide');
      $("#master-container").removeClass("disconnected");
      editorReadOnly(false);
    }
    dccount = 0;
  }

  if (max_disconnects == dccount++)
  {
    $('#disconnection-error-alert').removeClass('hide');
    $("#master-container").addClass("disconnected");
    editorReadOnly(true);
  }
  if(socket.websocket.readyState == 3) { // if socket is closed
    socket = new SeashellWebsocket("wss://" + creds.host + ":"+creds.port, creds.key);
    socket.ready.done(onReconnect);
  }
  else
    socket.ping().done(onReconnect);
}

// static variable that holds the list of projects currently available on Marmoset
SeashellProject.marmosetProjects = [];

/**
 * Updates the list of marmoset projects in the submit dialog, and the marmosetProjects variable.
 */
function updateMarmosetProjects() {
    $.ajax({
            url: "https://www.student.cs.uwaterloo.ca/~cs136/cgi-bin/marmoset-utils/project-list.rkt",
            dataType: "json"})
     .done(
        function(data){
            if (! data.error) {
              SeashellProject.marmosetProjects = data.map(function (project) {return project.project;});
              var marmoset_tag = $("#marmoset_project");
              marmoset_tag.html("");
              for(var i = 0; i < data.length; i++){
                  marmoset_tag.append(
                      $("<option>").attr("value", data[i].project).text(data[i].project));
                  }
            }
        })
    .fail(function () {});
}

/**
 * Fetches new assignment skeletons, if any are available
 */
function fetchNewAssignments() {
    var def = $.Deferred();
    SeashellProject.getListOfProjects().done(function(projects){
        $.get("https://www.student.cs.uwaterloo.ca/~cs136/cgi-bin/skeleton_list.cgi", function(data){
        
            var failed = false; // flag which tracks whether or not any skeleton clones failed

            // recursive function for cloning all available skeletons
            // does not block; will call def.resolve() once all projects are cloned
            function tryCloneSkeleton(num){
                if(num < data.length){
                    if(projects.indexOf(data[num]) == -1){
                        console.log("Fetching assignment template " + data[num] + ".");
                        socket.newProjectFrom(data[num], sprintf("file:///u/cs136/public_html/assignment_skeletons/%s", data[num]))
                            .done(function( ) {
                                tryCloneSkeleton(num + 1);
                            }).fail(function( info ) {
                                displayErrorMessage(sprintf("Failed to fetch %s; %s.", data[num], info));
                                failed = true;
                                tryCloneSkeleton(num + 1);
                            });
                    } else {
                      tryCloneSkeleton(num + 1);
                    }
                }else{
                    if(failed)  def.reject();
                    else        def.resolve();
                }
            }
            tryCloneSkeleton(0);
        });
    });

    return def.promise();
}

SeashellProject.new = function(name) {
  return socket.newProject(name)
    .fail(function() {
      displayErrorMessage("Project "+name+" could not be created.");
    });
}

/*
  Retrieves the Marmoset public test results for the given question and
  displays them in a table.
*/
SeashellProject.prototype.getMarmosetResults = function(marm_project) {
  var def = $.Deferred();
  $.ajax({
    url: "https://www.student.cs.uwaterloo.ca/~cs136/cgi-bin/marmoset-utils/public-test-results.rkt",
    data: {user: creds.user, project: marm_project},
    dataType: "json"})
  .done(
    function(result) {
      if(result.error) {
        def.reject(result.result);
        return;
      }
      var data = result.result;
      if(data.length > 0 && data[0].status == "complete") {
        var sub_pk = data[0].submission;
        $("#marmoset-details-span").html("Last submission <abbr class='timeago'>"+data[0].timestamp+"</abbr>. Submission has been tested.");
        var marm_tag = $("#marmoset-details-tbody").html("");
        var total = 0, total_passed = 0;
        for(var i=0; i < data.length && data[i].submission == sub_pk; i++) {
          marm_tag.append("<tr><td>"+data[i].name+"</td><td>"+data[i].outcome+"</td><td><pre>"+data[i].short+"</pre></td><td><pre>"+data[i].long+"</pre></td></tr>");
          total_passed += (data[i].outcome == "passed" ? data[i].points : 0);
          total += data[i].points;
        }
        $("#toolbar-results-data").text("("+total_passed+"/"+total+")")
          .removeClass("hide");
        $("#toolbar-results-text").text(total_passed == total ? "passed" : "failed");
        $("#marmoset-details-table").removeClass("hide")
        $("#marmoset-details-total").text(total_passed+"/"+total+" scored on public tests.").removeClass("hide");
        $("abbr.timeago").attr("title", data[0].timestamp).timeago();
      }
      else if (data.length > 0) {
        $("#marmoset-details-span").html("Last submission <abbr class='timeago'>"+data[0].timestamp+"</abbr>. Submission has not been tested yet.");
        $("abbr.timeago").attr("title", data[0].timestamp).timeago();
      } else {
        $("#marmoset-details-span").html("No submissions tested yet.");
      }
      def.resolve(data.length > 0 && data[0].status == "complete");
  }).fail(function() {
    def.reject();
  });
  return def.promise();
}

/*
 * Constructor for SeashellProject
 * Parameters:
 * name - full file path & name, eg. tests/small.in
 * callback - function to be called after project is created. Will be passed the
 *    the new SeashellProject as a parameter.
*/
function SeashellProject(name, callback) {
  this.name = name;
  this.files = null;
  this.currentFile = null;
  this.currentQuestion = null;
  this.currentErrors = null;
  this.currentPID = null;
  var lockPromise = socket.lockProject(name);
  var openNoLock = function(){ projectOpenNoLock(name); };

  lockPromise.done(openNoLock).fail(function(res){
    if(res == "locked"){
        displayConfirmationMessage("Project is locked by another browser instance",
            "Press OK to forcibly unlock the project, or Cancel to abort.",
            function(){
                var forceLockPromise = socket.forceLockProject(name);
                forceLockPromise.done(openNoLock).fail(function(){
                    displayErrorMessage("Project "+name+" could not be unlocked.");
                });
            });
    }else{
        displayErrorMessage("Project "+name+" failed to lock.");
    }
  });

  var p = this;
/**
 * Opens a new project and sets the current project (without locking).
 * @param {String} project Name of project to open.
 */
  function projectOpenNoLock(name) {
    var promise = socket.listProject(name);

    /** Update the list of files. */
    promise.done(function(files) {
      p.files = [];
      p.currentErrors = [];
      _.forEach(files, function(file) {
        p.placeFile(new SeashellFile(p, file[0], file[1], file[2]));
      });
      if (callback)
        callback(p, files);
    }).fail(function(){
      displayErrorMessage("Project "+name+" could not be opened.");
    });
  }

  /** Install the I/O handler. */
  socket.requests[-3].callback = this.IOHandler;
}

/*
 * Opens a project with the given name.
 * callback is called with the new SeashellProject instance once it is created.
*/
SeashellProject.open = function(name, callback) {
  if(SeashellProject.currentProject)
    SeashellProject.currentProject.close();
  SeashellProject.currentProject = new SeashellProject(name, callback);
};

SeashellProject.currentProject = null;

/*
 * Constructor for SeashellFile
 * Parameters:
 * project - Project this file is associated with.
 * name - the full file path & name from root of project
 * is_dir - boolean, true if this is a directory. Default is false.
 * last_saved - last time the file was saved, in milliseconds.
 *    If not provided, defaults to Date.now()
 *
 * SeashellFile's fields:
 * - name: file path from root as an array
 * - document: the CodeMirror document object for the file
 * - children: array of children if object is a directory
 * - is_dir: boolean, true if object is a directory
 * - last_saved: last time that the file was saved, in milliseconds
 * - unsaved: false if this file is saved already, otherwise a timer ID
 *            for when we'll save the file.
*/
function SeashellFile(project, name, is_dir, last_saved) {
  this.name = name.split("/");
  this.document = null;
  this.project = project;
  this.children = is_dir ? [] : null;
  this.is_dir = is_dir ? true : false;
  this.last_saved = last_saved ? last_saved : Date.now();
  this.unsaved = false;
}

/*
 * Returns the full file path and name for a SeashellFile
*/
SeashellFile.prototype.fullname = function() {
  return this.name.join("/");
};

/*
 * Creates a new file in the project
 * fname should be the full path from project root, ie. dir/fname.c
*/
SeashellProject.prototype.createFile = function(fname) {
  var p = this;
  if(this.exists(fname)) {
    displayErrorMessage("File "+fname+" already exists.");
    return null;
  }
  else {
    var dirname = fname.split('/');
    dirname.pop();
    return p.createDirectory(dirname.join('/'))
      .done(function() {
        return socket.newFile(p.name, fname).done(function() {
          var nFile = new SeashellFile(p, fname);
          var ext = fname.split(".").pop();
          var def = "\n";
          var doc_type = "text/plain";
          if(ext=="c"||ext=="h") {
            def = "/**\n * File: "+fname+"\n * Enter a description of this file.\n*/\n";
            doc_type = "text/x-csrc";
          }
          else if(ext=="rkt") {
            def = "#lang racket\n;; File: "+fname+"\n;; Enter a description of this file.\n";
            doc_type = "text/x-scheme";
          }
          nFile.document = CodeMirror.Doc(def, doc_type);
          nFile.document.on("change", function() { handleDocumentChange(nFile); });
          p.placeFile(nFile);
          p.openFile(nFile);
        }).fail(function() {
          displayErrorMessage("Error creating the file "+fname+".");
        });
      });
  }
};

/*
 * Creates a new directory in the project.
 * dname should be full path from project root.
*/
SeashellProject.prototype.createDirectory = function(dname) {
  var p = this;
  if(this.exists(dname))
    return $.Deferred().resolve().promise();
  return socket.newDirectory(this.name, dname).done(function() {
    var dirObj = new SeashellFile(p, dname, true);
    p.placeFile(dirObj);
  }).fail(function() {
    displayErrorMessage("Error creating the directory "+dname+".");
  });
}

/*
 * Places a file in the correct place in a project
 * file - a SeashellFile instance
 * removeFirst - if true, first searches files and removes the given
 *    file if it is already in the project.
*/
SeashellProject.prototype.placeFile = function(file, removeFirst) {
 function rmv(aof) {
    for(var f in aof) {
      if(f.children) {
        f.children = rmv(f.children);
      }
      else if(f === file) {
        return aof.splice(aof.indexOf(f), 1);
      }
    }
    return aof;
  }

  function plc(aod, aof) {
    if(aod.length > 1) {
      for(var i=0; i < aof.length; i++) {
        if(aof[i].is_dir && aof[i].name[aof[i].name.length-1] == aod[0]) {
          aof[i].children = plc(aod.slice(1), aof[i].children);
        }
      }
    }
    else {
      aof.push(file);
    }
    return aof;
  }

  if(removeFirst) {
    this.files = rmv(this.files);
  }
  if(file) {
    this.files = plc(file.name, this.files);
  }
};

SeashellProject.prototype.openFilePath = function(path) {
  var file = this.getFileFromPath(path);
  return this.openFile(file).done(function() {
    $(".hide-on-null-file").removeClass("hide");
    $(".show-on-null-file").addClass("hide");
    if (file.document)
      editorDocument(file.document);
  });
};

SeashellProject.prototype.openFile = function(file) {
  if (file.is_dir)
    return null;
  this.currentFile = file;
  editorShowUnreadableFilePlaceholder(false);
  if (file.document)
    return $.Deferred().resolve().promise();

  var result = $.Deferred();
  socket.readFile(this.name, file.name.join("/"))
    .done(function(contents) {
        var mime = "text";
        var ext = file.ext();
        if (ext == "c" || ext == "h")
          mime = "text/x-csrc";
        else if (ext == "rkt")
          mime = "text/x-scheme";
        file.document = CodeMirror.Doc(contents, mime);
        file.document.on("change", function() { handleDocumentChange(file); });
        result.resolve();
      })
    .fail(function() {
      editorShowUnreadableFilePlaceholder(!file.document);
      result.resolve();
    });
  return result;
};

/*
 * Saves all files in the project
 */
SeashellProject.prototype.save = function() {
  var promises = [];
  var p = this;
  function save_arr(aof) {
    for(var f=0; f < aof.length; f++) {
      if(aof[f].is_dir) save_arr(aof[f].children);
      else promises.push(aof[f].save());
    }
  }
  save_arr(this.files);
  return $.when.apply(null, promises)
    .fail(function() {
      displayErrorMessage("Project failed to save.");
    });
};

/*
 * Predicate. Returns true if there is unsaved work in the project.
 */
SeashellProject.prototype.isUnsaved = function() {
  for(var f=0; f < this.files.length; f++) {
    if(this.files[f].isUnsaved())
      return true;
  }
  return false;
};

/*
 * Saves the file.
 * pname - name of the file's project
 */
SeashellFile.prototype.save = function() {
  if(this.unsaved !== false) {
    var f = this;
    var thisTimer = f.unsaved;
    return socket.writeFile(this.project.name, this.fullname(), this.document.getValue())
      .done(function() {
        f.last_saved = Date.now();
        // only unset the unsaved flag if another modification has not been made
        if(f.unsaved == thisTimer) f.unsaved = false;
      })
      .fail(function() {
        displayErrorMessage("File "+f.fullname()+" could not be saved.");
      });
  }
  return $.Deferred().resolve().promise();
};

/*
 * Predicate. Returns true if the file or directory contains unsaved work.
 */
SeashellFile.prototype.isUnsaved = function() {
  if(this.is_dir) {
    for(var f=0; f < this.children.length; f++) {
      if(this.children[f].isUnsaved()) return true;
    }
    return false;
  }
  return this.unsaved !== false;
};

SeashellFile.prototype.lastSavedString = function() {
  var d = new Date(this.last_saved);
  return d.getFullYear() + "-" + (d.getMonth()+1) + "-" + d.getDate() + " " + d.getHours()
    + ":" + d.getMinutes() + ":" + d.getSeconds();
}

/*
 * Returns the file extension of the SeashellFile
*/
SeashellFile.prototype.ext = function() {
  return this.name[this.name.length-1].split(".").pop();
}

/*
 * Requests the list of all user's projects.
*/
SeashellProject.getListOfProjects = function() {
  return socket.getProjects()
    .fail(function() {
      displayErrorMessage("Could not fetch list of projects.");
    });
};

/*
 * Closes the project.
 * save - If true, saves project before closing
*/
SeashellProject.prototype.close = function(save) {
  if(this === SeashellProject.currentProject) {
    var proms = [];
    proms.push(socket.unlockProject(this.name));
    if(save) proms.push(this.save());
    window.clearInterval(this.saveInterval);
    SeashellProject.currentProject = null;
    delete this;
    return $.when.apply(proms)
      .fail(function() {
        displayErrorMessage("Project could not be closed.");
      });
  }
};

SeashellProject.prototype.closeFile = function(save) {
  if(this.currentFile) {
    if(save) this.currentFile.save();
    this.currentFile = null;
  }
};

/*
 * Deletes a file OR directory in the project.
 * file - a SeashellFile instance that is in the project
*/
SeashellProject.prototype.deleteFile = function(file) {
  if(file == this.currentFile) this.closeFile(false);

  function rmv(aof) {
    for(var f=0; f < aof.length; f++) {
      if(aof[f] == file) {
        aof.splice(aof.indexOf(aof[f]), 1);
        return aof;
      }
      else if(aof[f].children) {
        aof[f].children = rmv(aof[f].children);
      }
    }
    return aof;
  }
  var p = this;
  if(file.is_dir) {
    return socket.deleteDirectory(this.name, file.fullname())
      .done(function() {
        p.files = rmv(p.files);
      })
      .fail(function() {
        displayErrorMessage("Directory "+file.fullname()+" could not be deleted.");
      });
  }
  return socket.deleteFile(this.name, file.fullname())
    .done(function() {
      p.files = rmv(p.files);
    })
    .fail(function() {
      displayErrorMessage("File "+file.fullname()+" could not be deleted.");
    });
};

/*
 * Deletes the project.
*/
SeashellProject.prototype.remove = function(callback) {
  var p = this;

  this.close().done(function() {
    socket.deleteProject(p.name)
      .done(function() {
        if(callback)
          callback();
      })
      .fail(function() {
        displayErrorMessage("Project "+p.name+" could not be deleted.");
      });
  });
};

/*
 * Compiles the project.
 */
SeashellProject.prototype.compile = function() {
  var save_promise = handleSaveProject();
  var promise = $.Deferred();
  var p = this;
  save_promise.done(function () {
    socket.compileProject(p.name, p.currentFile.fullname(), promise);

    function writeErrors(errors) {
      for (var i = 0; i < errors.length; i++) {
        var error = errors[i][0], file = errors[i][1];
        var line = errors[i][2], column = errors[i][3];
        var message = errors[i][4];
        if (/relocation \d+ has invalid symbol index/.exec(message))
          continue;
        consoleWriteln(-1 == file.indexOf('final-link-result') ?
                       sprintf("%s:%d:%d: %s", file, line, column, message) :
                       message);
      }
    }

    promise.done(function(messages) {
      p.currentErrors = messages;
      writeErrors(p.currentErrors);
      editorLint();
    }).fail(function(result) {
      if (!Array.isArray(result))
      {
        displayErrorMessage("Project could not be compiled.");
        return;
      }
      consoleWriteln("# compilation failed with errors:");
      p.currentErrors = result;
      writeErrors(p.currentErrors);
      editorLint();
    });
  }).fail(function () {
    promise.reject(null);
    displayErrorMessage
      ("Compilation failed because project could not be saved.");
  });

  return promise;
};

SeashellProject.linter = function() {
  var found = [], project = SeashellProject.currentProject;
  if (project)
  {
    _.forEach(project.currentErrors,
              function(err) {
                var error = err[0], file = err[1];
                var line = _.max([err[2] - 1, 0]), column = err[3];
                var message = err[4];
                if (_.contains([project.currentFile.name.join("/"),
                                'final-link-result'],
                               file))
                  found.push({ from: CodeMirror.Pos(line, column),
                               to: CodeMirror.Pos(line),
                               message: message,
                               severity: 'error' });
              });
  }
  return found;
};

function sendEOF() {
    if(SeashellProject.currentProject.currentPID)
        socket.sendEOF(SeashellProject.currentProject.currentPID);
}

SeashellProject.run = function() {
  if(SeashellProject.currentProject) {
    return SeashellProject.currentProject.run();
  }
  return null;
};

SeashellProject.testResultNotify = function(ign, result) {
  var p = SeashellProject.currentProject;
  if(result.pid == p.currentPID) {
    consoleWriteln({ "timeout" : "Program timed out.",
                     "killed"  : "Test was stopped manually.",
                     "passed"  : "Test passed.",
                     "error"   : "Error: Program exited with code "+result.exit_code
                                  +".\n"+result.stderr,
                     "no-expect" : "No .expect file found. Program output:\n"+result.stdout,
                     "failed"  : "Test failed. Program output:\n"+result.stdout
                   }[result.result]);
    if(result.result == "killed")
      p.testQueue = [];
    if(!p.testQueue.length) {
      consoleWrite("# done");
      consoleWriteln();
      setPlayStopButtonPlaying(false);
      p.testQueue = p.currentTest = p.currentPID = null;
    }
    else {
      var test = p.testQueue.shift();
      consoleWrite(sprintf("# Running test '%s'... ", test));
      p.run(test).fail(function() { console.log("Test error"); })
        .done(function(res) {
          p.currentPID = res;
          p.currentTest = test;
        });
    }
  }
  else {
    displayErrorMessage("Can only run one program at a time.");
  }
}

SeashellProject.runTests = function() {
  var p = SeashellProject.currentProject;
  p.compile().done(function() {
    var tests = p.getTestsForFile(p.currentFile);
    if(tests.length) {
      p.testQueue = tests;
      SeashellProject.testResultNotify(null, { "pid" : null });
    }
    else {
      consoleWriteln(" No tests to run.");
    }
  });
};

SeashellProject.prototype.run = function(test) {
  // test - [optional] name of test to run with the program
  var ext = this.currentFile.name[this.currentFile.name.length-1]
    .split('.').pop();
  var src_name = this.currentFile.name[this.currentFile.name.length - 2];
  var compile_promise = ext == "rkt" ? handleSaveProject() : this.compile();
  var promise = $.Deferred();
  var p = this;

  function run() {
    setPlayStopButtonPlaying(true);
    socket.runProject(p.name, p.currentFile.name.join('/'),
                      test ? test : false, promise);

    promise.done(function(pid) {
      if (!test) {
        if (consoleDebug() && typeof pid == 'number')
          consoleWriteln(sprintf("# run '%s' (pid %d)", src_name, pid));
        else
          consoleWriteln(sprintf("# run '%s'", src_name));
      }
      if (typeof pid == 'number')
        p.currentPID = pid;
      else
        p.currentPID = null;
    }).fail(function() {
      setPlayStopButtonPlaying(false);
      displayErrorMessage("Project could not be run.");
    });
  }

  // TODO: If current PID is set, kill it.  This _is_
  // a bit of a race condition, but the side effects
  // (in JavaScript) are negligible, and it shouldn't
  // happen that often anyways.
  //
  // This can, and will happen whenever handles are reused.
  // Oh well.

  compile_promise.done(run).fail(function () { promise.reject(null); });

  return promise;
};

/*
 * Kills the running project.
 */
SeashellProject.prototype.kill = function() {
  return socket.programKill(this.currentPID).done(function() {
    SeashellProject.currentProject.currentPID = null;
  });
}

/*
 * Callback function that handles program input & output activity
*/
SeashellProject.prototype.IOHandler = function(ignored, message) {
  if (message.type == "stdout" || message.type == "stderr")
  {
    consoleWrite(message.message);
    return;
  }
  if (message.type != "done")
    return;

  setPlayStopButtonPlaying(false);
  editor.focus();
  if (consoleDebug())
    consoleWriteln(sprintf("\n# exited (pid %d) with code %d",
                           message.pid, message.status));
  else
    consoleWriteln(sprintf("\n# exited with code %d", message.status));

  if (this.currentPID == message.pid)
    this.currentPID = null;
};

/*
 * Should commit the project, currently just saves.
 */
SeashellProject.prototype.commit = function(description) {
  // TODO: actually commit
  return this.save();
};

/*
 * Requests an upload token for the project.
 * filename - the filename to be uploaded to
 */
SeashellProject.prototype.getUploadToken = function(filename) {
  return socket.getUploadFileToken(this.name, filename)
    .fail(function() {
      displayErrorMessage("Failed to get upload token.");
    });
};

/*
 * Function called on successful file upload.
 * filename - the filename that was uploaded
 */
SeashellProject.prototype.onUploadSuccess = function(filename) {
  this.placeFile(new SeashellFile(this, filename));
};

/*
 * Sends input to the currently running project.
 * input - the actual input to be sent
 */
SeashellProject.prototype.input = function(input) {
  return socket.programInput(this.currentPID, input)
    .fail(function() {
      displayErrorMessage("Input was not successfully sent.");
    });
};

/*
 * Requests a download token for the project.
 */
SeashellProject.prototype.getDownloadToken = function() {
  return socket.getExportToken(this.name)
    .fail(function() {
      displayErrorMessage("Could not get project download token.");
    });
};

/*
 * Renames a file in the project.
 * file - SeashellFile instance to rename
 * name - new name (full path from project root) of the file
 */
SeashellProject.prototype.renameFile = function(file, name) {
  var p = this;
  return socket.renameFile(this.name, file.fullname(), name)
    .done(function() {
      file.name = name.split("/");
      p.placeFile(file, true);
    })
    .fail(function() {
      displayErrorMessage("File could not be renamed.");
    });
};

/* finds a SeashellFile in the project given its path as a string
*/
SeashellProject.prototype.getFileFromPath = function(path) {
  function find(array, p) {
    for(var i=0; i < array.length; i++) {
      if(array[i].name[array[i].name.length-1] == p[0]) {
        if(p.length==1) {
          return array[i];
        }
        else {
          return find(array[i].children, p.slice(1));
        }
      }
    }
    return false;
  }
  return find(this.files, path.split('/'));
};

/*
 * Returns an array of test file filenames
*/
SeashellProject.prototype.getTestsForFile = function(file) {
  var testDir = this.getFileFromPath(file.name[0] + '/tests');
  var arr = [];
  if(testDir && testDir.is_dir) {
    for(var i=0; i < testDir.children.length; i++) {
      if(testDir.children[i].ext() == "in") {
        var name = testDir.children[i].name[testDir.children[i].name.length-1];
        name = name.split(".");
        name.pop();
        arr.push(name.join("."));
      }
    }
  }
  return arr;
};

/**
 * Writes user settings to their homedir on backend
 */
function writeSettings(settings){
  socket.saveSettings(settings);
}

/**
 * Reads user settings from their homedir on backend (uses defaults if they
 * don't exist), updates the global settings variable, and applies the settings
 *
 * Parameters:
 *  succ, a callback which is called when settings are successfully refreshed
 *  fail, a callback which is called when settings fail to be refreshed
 */
// TODO: call this function after logging into seashell
function refreshSettings(succ, fail){
  // default settings
  var defaults = {
    font_size  : 10,
    edit_mode  : "standard",
    tab_width  : 4,
    use_space  : true,
    text_style : "neat"
  };

  // function which applies the currently loaded settings to CodeMirror
  function applySettings(){
    $(".CodeMirror").css("font-size", settings["font_size"] + "pt");
    if(settings["edit_mode"] == "vim"){
        editor.setOption("vimMode", true);
    }else if(settings["edit_mode"] == "emacs"){
        editor.setOption("vimMode", false);
        editor.setOption("keyMap", "emacs");
    }else{
        editor.setOption("vimMode", false);
        editor.setOption("keyMap", "default");
    }
    editor.setOption("tabSize", settings["tab_width"]);
    editor.setOption("indentUnit", settings["tab_width"]);
    editor.setOption("theme", settings["text_style"]);
    editor.addKeyMap({"Tab": "insertSoftTab"});
    // TODO: implement expandtab

    // change the options in the Settings menu to the new settings
    $("#editor_font").val(settings["font_size"]);
    $("#editor_mode").val(settings["edit_mode"]);
    $("#tab_width").val(settings["tab_width"]);
    $("#text_style").val(settings["text_style"]);
  }


  // read user settings from server, or use default if no settings exist
  var promise = socket.getSettings();
  promise.done(function (res){
    settings = defaults;
    if (res) {
      for(var key in res) {
        settings[key] = res[key];
      }
    }
    applySettings();
    if(succ) succ();
  }).fail(function (res){
    console.log("ERROR: Could not read settings from server.");
    if(fail) fail();
    return;
  });
}

/* predicate to determine if given filename exists in the project
*/
SeashellProject.prototype.exists = function(fname) {
  function check(aof) {
    for(var f=0; f < aof.length; f++) {
      if(aof[f].fullname() == fname)
        return true;
      if(aof[f].children) {
        if(check(aof[f].children))
          return true;
      }
    }
    return false;
  }
}

/*
  Based on the project name and current question, returns the Marmoset assignment name based on the usual convention.
  If the project name and question do not match the usual convention, returns false.
*/
SeashellProject.prototype.currentMarmosetProject = function() {
  if(/^a[0-9]+$/i.test(this.name) && /^q[0-9]+[a-z]?$/i.test(this.currentQuestion)) {
    var guess = this.name.replace(/^a/i, "A") + this.currentQuestion.replace(/^q/i, "P");
    var extended = guess+"Extended";
    if(SeashellProject.marmosetProjects.indexOf(extended) >= 0)
      return extended;
    if(SeashellProject.marmosetProjects.indexOf(guess) >= 0)
      return guess;
  }
  return false;
}

/*
  Submits the currently open question to the given Marmoset project
*/
SeashellProject.prototype.submit = function(marm_project) {
  var p = this;

  var dfd = $.Deferred();
  p.save().done(function () {
    function fetchMarmosetResults(timeout) {
      var t = setTimeout(function() {
        p.getMarmosetResults(marm_project).done(function(test_run) {
          if(!test_run)
            fetchMarmosetResults(timeout * 1.5);
        });
      }, timeout);
    }
    return socket.marmosetSubmit(p.name, marm_project, p.currentQuestion)
      .done(function() {
        fetchMarmosetResults(2000);
        dfd.resolve();
      }).fail(function (message) {
        dfd.reject(message);
      });
  }).fail(function (message) {
    dfd.reject(message);
  });

  return dfd;
}

