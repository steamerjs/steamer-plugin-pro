"use strict";

const fs = require('fs-extra'),
	  argv = require('yargs').argv,
	  exec = require('child_process').exec,
	  _ = require('lodash'),
	  path = require('path'),
	  pluginUtils = require('steamer-pluginutils');

var utils = new pluginUtils();
utils.pluginName = "steamer-plugin-pro";

function emptyFunc() {};

function ProPlugin(argv) {
	this.argv = argv;
	this.config = null;
	this.tmpConfig = {};   // temporary config
	this.processCount = 0; // child process count
}

ProPlugin.prototype.init = function() {
	
	let argv = this.argv;

	this.readConfig();

	if (argv.i || argv.init) {
		this.config = {
			projects: {},
			steps: {			// callback
		        start: {},		// npm start callback
		        build: {},		// npm run build callback
		    }
		};
		let dirs = ["./"],
			depth = argv.d || argv.depth;
			depth = (depth && depth !== true) ? depth : 2;

		console.log(depth);
		this.createConfig(dirs, depth);
	}
	else if (argv.s || argv.start) {
		this.start();
	}
	else if (argv.b || argv.build) {
		this.build();
	}

};

/**
 * [walk through folders]
 * @param  {Array} dirPath  [folders need to be walked through]
 * @return {Arrays}         [filtered folders]
 */
ProPlugin.prototype.walkDir = function(dirPath) {
	let dirs = fs.readdirSync(dirPath),
		stats = fs.statSync(dirPath);

	dirs = dirs.filter((item, key) => {
		let idDirectory = fs.lstatSync(path.join(dirPath, item)).isDirectory();
		return item !== "node_modules" && item !== ".git" && item !== ".steamer"
			   && idDirectory;
	});

	dirs = dirs.map((item, key) => {
		return path.join(dirPath, item);
	});

	console.log(dirs);
	return dirs;
};

/**
 * [read package.json to judge whether this is a project]
 * @param  {Array} dirs [potential project dirs]
 */
ProPlugin.prototype.readPkgJson = function(dirs) {
	dirs.map((item, key) => {
		let projectPath = path.resolve(item),
			pkgJsonPath = path.join(projectPath, "package.json");
		
		if (fs.existsSync(pkgJsonPath)) {
			let pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
			this.config.projects[pkgJson.name] = {
				folder: projectPath,
				cmds: {
					start: pkgJson.scripts.start || "",
					build: pkgJson.scripts.build || ""
				}
			};
		}
	});
};

/**
 * [create config]
 */
ProPlugin.prototype.createConfig = function(dirs, d) {

	let depth = d,
		nextDirs = [];

	this.readPkgJson(dirs);

	dirs.map((item, key) => {
		nextDirs = this.walkDir(item);
		if (depth > 0) {
			this.createConfig(nextDirs, depth - 1);
		}
	});

	if (depth === 1) {
		let isJs = true,
		isForce = (this.argv.f || this.argv.force) ? true : false;

		utils.createConfig("", this.config, isJs, isForce);
	}

};

/**
 * [read config]
 */
ProPlugin.prototype.readConfig = function() {
	let isJs = true;
	this.config = utils.readConfig("", isJs);
};

/**
 * [start command]
 */
ProPlugin.prototype.start = function() {
	let subProject = this.argv.s || this.argv.start;
	subProject = (subProject && subProject !== true) ? subProject : null;
	this.runCommand("start", subProject);
};

/**
 * [build command]
 */
ProPlugin.prototype.build = function() {
	let subProject = this.argv.b || this.argv.build;
	subProject = (subProject && subProject !== true) ? subProject : null;
	this.runCommand("build", subProject);
};

ProPlugin.prototype.runCommand = function(cmdType, subProject) {

	if (!this.config) {
		throw new Error("Config file is not found.");
	}

	let projectConfig = this.config.projects || {},
		projects = Object.keys(projectConfig) || [],
		projectFolder = [],
		projectCmds = [];

	// only for a subproject
	if (subProject) {
		projects = projects.filter((item, key) => {
			return (item === subProject);
		});
	}

	projects.map((item, key) => {
		let project = projectConfig[item];

		projectFolder.push(project.folder);
		projectCmds.push(project.cmds[cmdType]);
	});

	projectFolder.map((cwd, key) => {
		let cmd = projectCmds[key];

		let stepFinish = emptyFunc;

		if (this.config.steps && this.config.steps[cmdType]) {
			stepFinish = this.config.steps[cmdType].finish || emptyFunc;
		}

		this.runningProcess({
			projects,
			projectFolder,
			projectCmds,
			cmdType,
			cmd,
			key,
			cwd, // current working directory of the process
		}, stepFinish).bind(this)();
	});

	// console.log(projects, projectFolder, projectCmds);
};

ProPlugin.prototype.runningProcess = function(opt, cb) {
	// console.log(opt, cb);

	let projects = opt.projects,
		projectFolder = opt.projectFolder,
		projectCmds = opt.projectCmds,
		cmdType = opt.cmdType,
		cmd = opt.cmd,
		key = opt.key,
		cwd = opt.cwd;

	return () => {

		let childProcess = exec(cmd, {cwd}, function (error, stdout, stderr) {
			
        });

		this.tmpConfig[childProcess.pid] = _.merge({
        	currentProject: projects[key],
        }, this.config);

		if (this.config.steps && this.config.steps[cmdType]) {
			let stepStart = this.config.steps[cmdType].start || emptyFunc;
			stepStart.bind(this)(this.tmpConfig[childProcess.pid]);
		}

        childProcess.stdout.on('data', function (data) {
        	console.log(projects[key] + ': \n' + data);
        });

        childProcess.stderr.on('data', function (data) {
        	console.log(projects[key] + ': \n' + data);
        });

        childProcess.on('exit', (code) => {
        	// count whether all child processes reach the end
        	this.processCount++;
        	this.tmpConfig[childProcess.pid].isEnd = (this.processCount === projects.length) ? true : false;

        	// keep config state
        	cb.bind(this)(this.tmpConfig[childProcess.pid]);
        	console.log(projects[key] + ': \n' + 'child process exited with code ' + code);

        	if (this.processCount === projects.length) {
        		this.processCount = 0;
        		this.tmpConfig = {};
        	}

        });

	};
};

module.exports = ProPlugin;