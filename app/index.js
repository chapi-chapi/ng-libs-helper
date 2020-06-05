#! /usr/bin/env node
const fs = require("fs"),
  path = require("path");
/** Makes the specific lib scripts stick out from the noise of the tasks */
const consoleColors = {
  reset: "\x1b[0m",
  normal: "\x1b[36m",
  warning: "\x1b[33m",
  error: "\x1b[31m",
};
const output = (outputText, color = consoleColors.normal) =>
  console.log(color, outputText, consoleColors.reset);
//#region ReadInConfigOptions
const optionsFileName = path.resolve("./libs.config.json");
let options;
if (fs.existsSync(optionsFileName)) {
  options = JSON.parse(fs.readFileSync(optionsFileName));
} else {
  output(
    consoleColors.warning,
    `No options file found at ${optionsFileName}. Using default values.`
  );
}
const getOption = (optionName, defaultValue = "") =>
  options && options[optionName] ? options[optionName] : defaultValue;
let libsPath = getOption("projectsPath", "./projects");
const angularJsonPath = getOption("angularJsonPath", "./angular.json");
const karmaConfigPath = getOption("karmaConfigPath");
const tsconfigPath = getOption("tsconfigPath", "./tsconfig.json");
/** The name of the root app for displaying the components - used when querying the angular.json file */
let showcaseProjectName = getOption("showcaseProjectName");
const libPrefix = getOption("libraryNamePrefix");
const scopeName = getOption("scopeName");
const isPublicScope = getOption("isPublicScope", true);
const waitOnFile = getOption("libFileToWaitOnForBuild", "public-api.d.ts");
const npmrcPath = getOption("npmrcPath");
//#endregion ReadInConfigOptions

//#region HelperFunctions
const ensurescopeName = (libName) =>
  scopeName
    ? `${scopeName.replace("@", "")}\\${libName.replace(scopeName, "")}`
    : libName;
const ensurePrefix = (libName) =>
  `${libPrefix}${libName.replace(libPrefix, "")}`;

libsPath = libsPath + (scopeName ? `\\${scopeName.replace("@", "")}` : "");
addScope = scopeName ? `${scopeName}/` : "";

const getProjectNames = (lPath = libsPath) => {
  output(`Looking in ${lPath} for projects`);
  return fs.existsSync(lPath)
    ? fs
        .readdirSync(lPath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
    : [];
};

const getLibArgs = (getAllProjectsIfNoArgs = true) => {
  const args = process.argv.slice(3);
  let libs = [];
  if ((getAllProjectsIfNoArgs && !args) || args.length === 0) {
    const projectsPath = path.resolve(libsPath);
    output(
      `No library name(s) passed in, getting all libraries from ${projectsPath}.`
    );

    libs = getProjectNames();
  } else {
    if (args.length === 0) {
      output("You must specify a library name!");
      return;
    }
    libs = args
      .map((args) => args.split(","))
      .reduce((acc, arg) => acc.concat(arg))
      .filter((arg) => arg.trim().length > 0) // remove whitespace
      .map((arg) => arg.trim().toLowerCase());
  }
  return libs;
};

/** Takes in an argument for a comma seperated list of libraries (or an individual one) to perform a specific command on each library specified.
 * @param individualLibCommandFunc A callback function of type ```:: libName:string => string```.
 * @param getAllProjectsIfNoArgs If set to true then will run command against all projects in projects folder if no args are passed in.
 * For example ```(libName) => `dosomethingWith(${libName})` ```
 */
const processLibScript = (
  individualLibCommandFunc,
  getAllProjectsIfNoArgs = false,
  postScriptActions,
  waitForPrevious = true
) => {
  const libs = getLibArgs(getAllProjectsIfNoArgs);
  output(`Running command against ${libs.length} libs:`);
  console.log(libs);

  for (let index = 0; index < libs.length; index++) {
    const lib = libs[index];
    let command = individualLibCommandFunc(lib);
    output(
      "------------------------------------------------------------------------------"
    );
    output(`Processing library ${index + 1} of ${libs.length}`);
    if (index > 0 && waitForPrevious)
      command = `wait-on ${path.resolve(
        `${libsPath}/${libs[index - 1]}/package.json`
      )} -d 200 && ${command}`;
    output(command);
    output(
      "------------------------------------------------------------------------------"
    );
    const shell = require("shelljs");
    shell.exec(command, (code, stdout, stderr) => {
      if (code !== 0) output(consoleColors.error, `Exit code: ${code}`);
      if (stdout) output(stdout);
      if (stderr) output(consoleColors.error, stderr);

      if (postScriptActions) {
        output("Running postscript action:");
        postScriptActions(lib);
      }
    });
  }
  return libs;
};

const onlyDoIfDistExists = (lib, pathToCommandStringFunc) => {
  const libPath = path.resolve(`./dist/${ensurescopeName(ensurePrefix(lib))}`);
  if (require("fs").existsSync(path)) return pathToCommandStringFunc(path);
  else {
    output(consoleColors.warning, `no path ${path} was found`);
    return "";
  }
};

/** #### _Get into the folder. Do the command. Get back in time for tea_
 * Required because some `npm` commands don't let you provide an output flag or run against a different directory */
const performCommandInLibDistFolder = (lib, command) =>
  onlyDoIfDistExists(
    lib,
    (libPath) => `cd ${libPath} && ${command} && cd ${path.resolve("../..")}`
  );

//#endregion HelperFunctions

//#region CommandLogic
const pack = () =>
  processLibScript((lib) => performCommandInLibDistFolder(lib, "npm pack"));
const publish = () =>
  processLibScript((lib) =>
    performCommandInLibDistFolder(
      lib,
      `npm publish ${isPublicScope ? "--access public" : ""}`
    )
  );
const packAndPublish = () =>
  processLibScript((lib) =>
    performCommandInLibDistFolder(
      lib,
      `npm pack && npm publish ${isPublicScope ? "--access public" : ""}`
    )
  );
const add = () =>
  processLibScript(
    (lib) =>
      `ng generate library ${addScope}${ensurePrefix(lib)}${
        npmrcPath
          ? `&& copy ${npmrcPath} .\\projects\\${ensurescopeName(
              ensurePrefix(lib)
            )}`
          : ""
      } ${
        karmaConfigPath
          ? `&& rimraf .\\projects\\${ensurescopeName(
              ensurePrefix(lib)
            )}\\karma.conf.js`
          : ""
      }`,
    false,
    (lib) => configs()
  );
const remove = () =>
  processLibScript(
    (lib) => `rimraf ${libsPath}\\${ensurePrefix(lib)}`,
    false,
    (lib) => configs(),
    false
  );

const configs = () => {
  const libNames = getProjectNames();

  const mutateObj = (path, getProp, additionalActions) => {
    let fileJson = JSON.parse(fs.readFileSync(path));
    const fileJsonKey = getProp(fileJson);

    if (!showcaseProjectName && path === angularJsonPath) {
      showcaseProjectNames = Object.keys(fileJsonKey).filter(
        (x) => fileJsonKey[x].projectType === "application"
      );
      output(
        consoleColors.warning,
        `${
          showcaseProjectNames.length > 0
            ? `No showcaseProjectName set in options, setting to ${showcaseProjectNames[0]}`
            : "No showcaseProjectName found in options or angular.json."
        }`
      );
      showcaseProjectName = showcaseProjectNames[0];
    }

    Object.keys(fileJsonKey)
      .filter((x) => x !== showcaseProjectName)
      .forEach((libName) => {
        const rawName = libName.replace(addScope, "");
        if (!libNames.some((x) => x === rawName)) {
          output(
            consoleColors.warning,
            `${rawName} was found in ${path} but not in ${libsPath} - DELETING FROM ${path}`
          );
          delete fileJsonKey[libName]; // remove key as no associated project
        }
        output("libNames:");
        console.log(libNames);

        additionalActions(fileJsonKey, libName);
      });
    fs.writeFileSync(path, JSON.stringify(fileJson, null, 2));
    output(`${path} contains following library projects:`);
    console.log(
      Object.keys(fileJsonKey).filter((x) => x !== showcaseProjectName)
    );
  };
  mutateObj(
    angularJsonPath,
    (json) => json.projects,
    (jsonKey, libName) => {
      // Set Karma path to top-level to avoid CI issues
      if (
        karmaConfigPath &&
        jsonKey[libName] &&
        jsonKey[libName].architect &&
        jsonKey[libName].architect.test
      ) {
        const karmaConfPath =
          jsonKey[libName].architect.test.options.karmaConfig;
        if (karmaConfPath !== karmaConfigPath) {
          output(
            consoleColors.warning,
            `${libName} karmaConfig path: ${karmaConfPath}. Setting to ${karmaConfigPath}.`
          );
        }
        jsonKey[libName].architect.test.options.karmaConfig = "karma.conf.js";
      }
    }
  );
  mutateObj(
    tsconfigPath,
    (json) => json.compilerOptions.paths,
    (jsonKey, libName) => {
      // Add path to tsconfig to allow for switching between local and built version (for sourcemappings)
      const libProjectsPath = `${libsPath}/${libName}/src/public-api.ts`;

      libName = `${addScope}${libName}`;
      if (jsonKey[libName]) {
        const libProjPathIndex = jsonKey[libName].indexOf(libProjectsPath);
        if (libProjPathIndex <= 0) {
          if (libProjPathIndex === 0) {
            output(
              consoleColors.warning,
              `${libProjectsPath} was found at index 0 in ${tsconfigPath} - MOVING TO END OF ARRAY`
            );
            jsonKey[libName].splice(0, 1);
          } else
            output(
              consoleColors.warning,
              `No project path for ${libName} found in ${tsconfigPath}; ADDING.`
            );
          jsonKey[libName].push(libProjectsPath);
        }
      }
    }
  );
};

const getLibDependenciesToWaitOn = (libName, allLibArgs, unBuiltProjects) => {
  const packageJson = JSON.parse(
    fs.readFileSync(`${libsPath}\\${libName}\\package.json`)
  );
  const peerDependencies = packageJson.peerDependencies;
  if (peerDependencies) {
    const projects = getProjectNames();
    const dependencies = Object.keys(peerDependencies).filter(
      (key) => projects.indexOf(key) > -1
    );
    if (dependencies.length > 0) {
      const unbuiltDependencies = dependencies.filter(
        (x) => allLibArgs.indexOf(x) === -1 && unBuiltProjects.indexOf(x) > -1
      );

      output(`Found ${dependencies.length} lib dependencies in ${libName}`);
      console.log(
        dependencies.map(
          (x) =>
            `${x} (Currently ${
              unbuiltDependencies.indexOf(x) === -1
                ? allLibArgs.indexOf(x) >= -1
                  ? "Building"
                  : "Built"
                : "Unbuilt - WILL BUILD FIRST"
            })`
        )
      );

      return `${
        unbuiltDependencies.length > 0
          ? `${unbuiltDependencies
              .map((x) => `ng build ${addScope}${x}`)
              .join(" && ")} && `
          : ""
      }wait-on ${dependencies
        .map((x) => `dist\\${x}\\${waitOnFile}`)
        .join(" ")} && `;
    }
  }
  return "";
};

const buildAndServe = (watch = true, serve = true, runConcurrently = true) => {
  const concurrently = require("concurrently");
  const libs = getLibArgs(false).map((x) => ensurePrefix(x));
  output(libs);

  const projectNames = getProjectNames();
  const preBuiltProjects = getProjectNames(
    "./dist" + scopeName ? `/${scopeName}` : ""
  );
  const unBuiltProjects = projectNames.filter(
    (x) => preBuiltProjects.indexOf(x) === -1 && libs.indexOf(x) === -1
  );
  const filesToWaitOn = libs
    .map((lib) => `dist\\${lib}\\${waitOnFile}`)
    .join(" ");
  const waitAndServeCommand = `wait-on ${filesToWaitOn} && ng serve --vendor-source-map --aot false `; // Having to set aot false for this version of angular, I believe latest version doesn't have this issue
  const libCommands = libs.map(
    (lib) =>
      `rimraf dist\\${lib} && ${getLibDependenciesToWaitOn(
        lib,
        libs,
        unBuiltProjects
      )}ng build ${addScope}${lib} ${watch ? "--watch" : ""}`
  );
  if (serve) libCommands.push(waitAndServeCommand);

  output(
    `${libCommands.length} commands to run${
      runConcurrently ? " concurrently" : ""
    }:`
  );
  output(libCommands);
  if (runConcurrently) {
    concurrently(libCommands).then(() => output("All Done :)"));
  } else {
    const shell = require("shelljs");
    libCommands.forEach((cmd) => shell.exec(cmd));
  }
};
//#endregion CommandLogic

//#region ModuleExports
// USAGE:
// All commands can be run using a parameter specifying a single library name or a comma seperated list of library names
// If no parameter is given then all library in the projects folder will be processed
module.exports = {
  build: () => buildAndServe(false, false),
  build_watch: () => buildAndServe(false, true),
  pack,
  publish,

  add,

  remove,

  configs,

  serve: () => buildAndServe(),
};
//#endregion

//#region Script
const commandArg = process.argv[2];
const commandToRun = module.exports[commandArg];
if (commandToRun) {
  commandToRun();
} else {
  output(
    consoleColors.warning,
    `${
      commandArg
        ? `No Command ${commandArg} was found`
        : "You must enter a command to run"
    }.`
  );
  output("Available Options are:");
  console.log(Object.keys(module.exports));
}
//#endregion Script
