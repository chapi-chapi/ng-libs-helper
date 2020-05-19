# ng-libs-helper
Scripts for working with angular library projects.

# Commands
## add
Adds one or more library projects whilst also [running the configs command](#configs).

![Add Screenshot](./screenshots/add.PNG)

## remove

## build
Builds all libaries, or the ones passed in as arguments.

![Build Screenshot](./screenshots/build.PNG)

## serve

## configs
This ensures that the angular.json and tsconfig.json files are updated and in the correct format.

![Configs Screenshot](./screenshots/configs.PNG)

You can see come more examples of this being run at the end of the [add](#add) and [remove](#remove) scripts.

# Notes
You may at some point get an error stating something about ngcc.lock such as this:

![Error Screenshot](./screenshots/build_error.PNG)

you should be able to just re-run the command and it will work - sometimes (very infrequently in my experience) this can just happen when running multiple ngcc commands.