#! /usr/bin/env node
const fs = require("fs");
/** Makes the specific lib scripts stick out from the noise of the tasks */
const consoleColors = {
  reset: "\x1b[0m",
  fgCyan: "\x1b[36m",
};
const output = (outputText) =>
  console.log(consoleColors.fgCyan, outputText, consoleColors.reset);
//#region ReadInConfigOptions
const optionsFileName = "./libs.config.json";
let options;
if (fs.existsSync(optionsFileName)) {
  options = JSON.parse(fs.readFileSync(optionsFileName));
} else {
  output(`No options file found at ${optionsFileName}. Using default values.`);
}
const getOption = (optionName, defaultValue = "") =>
  options && options[optionName] ? options[optionName] : defaultValue;
const libsPath = getOption("projectsPath", "./projects");
const angularJsonPath = getOption("angularJsonPath", "./angular.json");
const karmaConfigPath = getOption("karmaConfigPath", "karma.conf.js");
const tsconfigPath = getOption("tsconfigPath", "./tsconfig.json");
/** The name of the root app for displaying the components - used when querying the angular.json file */
let showcaseProjectName = getOption("showcaseProjectName");
const libPrefix = getOption("libraryNamePrefix");
const scopeName = getOption("scopeName");
const isPublicScope = getOption("isPublicScope", true);
const waitOnFile = getOption("libFileToWaitOnForBuild", "public-api.d.ts");
//#endregion ReadInConfigOptions

//#region HelperFunctions
const ensurescopeName = (libName) =>
  scopeName
    ? `${scopeName.replace("@", "")}\\${libName.replace(scopeName, "")}`
    : libName;
const ensurePrefix = (libName) =>
  `${libPrefix}${libName.replace(libPrefix, "")}`;

const getProjectNames = (path = ensurescopeName(libsPath)) => {
  return fs.existsSync(path)
    ? fs
        .readdirSync(path, { withFileTypes: true })
        .filter(
          (dirent) => dirent.isDirectory() && dirent.name !== "ng-k-styles"
        ) // Styles need to be handled differently
        .map((dirent) => dirent.name)
    : [];
};

const getLibArgs = (getAllProjectsIfNoArgs = true) => {
  const args = process.argv.slice(3);
  let libs = [];
  if ((getAllProjectsIfNoArgs && !args) || args.length === 0) {
    const path = require("path");
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
  getAllProjectsIfNoArgs = true,
  postScriptActions
) => {
  const libs = getLibArgs(getAllProjectsIfNoArgs);
  output(`Running command against ${libs.length} libs:`);
  console.log(libs);

  for (let index = 0; index < libs.length; index++) {
    const lib = libs[index];
    const command = individualLibCommandFunc(lib);
    output(
      "------------------------------------------------------------------------------"
    );
    output(`Processing library ${index + 1} of ${libs.length}`);
    output(command);
    output(
      "------------------------------------------------------------------------------"
    );
    const shell = require("shelljs");
    shell.exec(command);
    if (postScriptActions) postScriptActions(lib);
  }
  return libs;
};

/** #### _Get into the folder. Do the command. Get back in time for tea_
 * Required because some `npm` commands don't let you provide an output flag or run against a different directory */
const performCommandInLibDistFolder = (lib, command) =>
  `cd .\\dist\\${ensurescopeName(ensurePrefix(lib))} && ${command} && cd ../..`;

//#endregion HelperFunctions

//#region CommandLogic
const pack = () =>
  processLibScript((lib) => performCommandInLibDistFolder(lib, "npm pack"));
const publish = () =>
  processLibScript((lib) => performCommandInLibDistFolder(lib, "npm publish"));
const packAndPublish = () =>
  processLibScript((lib) =>
    performCommandInLibDistFolder(lib, "npm pack && npm publish")
  );
const add = () =>
  processLibScript(
    (lib) =>
      `ng generate library ${scopeName ? `${scopeName}/` : ''}${ensurePrefix(
        lib
      )} && copy .npmrc .\\projects\\${ensurescopeName(ensurePrefix(
        lib
      ))} && rimraf .\\projects\\${ensurescopeName(ensurePrefix(lib))}\\karma.conf.js`,
    false,
    (lib) => {
      const libName = ensurescopeName(ensurePrefix(lib));
      const fs = require("fs");
      const libDir = `${libsPath}/${libName}/src/lib`;
      const fileNames = fs
        .readdirSync(`${libDir}`, { withFileTypes: true })
        .map((x) => `${libDir}/${x.name}`);
    }
  );
const remove = () =>
  processLibScript((lib) => `rimraf ${libsPath}\\${ensurescopeName(ensurePrefix(lib))}`, false);

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
        `${
          showcaseProjectNames.length > 0
            ? `No showcaseProjectName set in options, setting to ${showcaseProjectNames[0]}`
            : "No showcaseProjectName found in options or angular.json."
        }`
      );
      showcaseProjectName = showcaseProjectNames[0];
    }

    Object.keys(fileJsonKey)
      .filter((x) => x !== showcaseProjectName && x != "ng-k-styles")
      .forEach((libName) => {
        if (!libNames.some((x) => x === libName)) {
          output(
            `${libName} was found in ${path} but not in ${libsPath} - DELETING FROM ${path}`
          );
          delete fileJsonKey[libName]; // remove key as no associated project
        }

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
        jsonKey[libName] &&
        jsonKey[libName].architect &&
        jsonKey[libName].architect.test
      ) {
        const karmaConfPath =
          jsonKey[libName].architect.test.options.karmaConfig;
        if (karmaConfPath !== karmaConfigPath) {
          output(
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

      libName = libName.replace(`${scopeName}/`, "");
      if (jsonKey[libName]) {
        const libProjPathIndex = jsonKey[libName].indexOf(libProjectsPath);
        if (libProjPathIndex <= 0) {
          if (libProjPathIndex === 0) {
            output(
              `${libProjectsPath} was found at index 0 in ${tsconfigPath} - MOVING TO END OF ARRAY`
            );
            jsonKey[libName].splice(0, 1);
          } else
            output(
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
    fs.readFileSync(`${libsPath}\\${ensurescopeName(libName)}\\package.json`)
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
                ? (allLibArgs.indexOf(x) >= -1 ? "Building" : "Built")
                : "Unbuilt - WILL BUILD FIRST"
            })`
        )
      );

      return `${
        unbuiltDependencies.length > 0
          ? `${unbuiltDependencies
              .map((x) => `ng build ${x}`)
              .join(" && ")} && `
          : ""
      }wait-on ${dependencies
        .map((x) => `dist\\${x}\\${waitOnFile}`)
        .join(" ")} && `;
    }
  }
  return "";
};

const buildAndServe = (watch = true, serve = true) => {
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
      )}ng build ${lib} ${watch ? "--watch" : ""}`
  );
  if (serve) libCommands.push(waitAndServeCommand);
  output(`${libCommands.length} commands to run concurrently:`);
  output(libCommands);
  concurrently(libCommands).then(() => output("All Done :)"));
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

  add: () => {
    add();
    configs();
  },
  remove: () => {
    remove();
    configs();
  },

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
