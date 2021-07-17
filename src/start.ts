process.env.MONGOMS_DEBUG = "1";
import fs from "fs";
import { MongoMemoryReplSet } from "mongodb-memory-server-global-4.4";
import path from "path";
import cluster from "cluster";
import os from "os";
import exitHook from "async-exit-hook";

const cores = Number(process.env.threads) || 1 || os.cpus().length;

if (cluster.isMaster && !process.env.masterStarted) {
	const dbPath = path.join(__dirname, "..", "data", "db");
	fs.mkdirSync(dbPath, { recursive: true });

	const replicaSetName = "rs0";

	const mongod = new MongoMemoryReplSet({
		// @ts-ignore
		autoStart: false,
		// instanceOpts: [{ dbPath }],
		replSet: {
			name: replicaSetName,
			dbName: "fosscord",
			storageEngine: "wiredTiger",
			count: 1,
		},
	});

	exitHook((callback) => {
		(async () => {
			console.log(`Stopping MongoDB ...`);
			await mongod.stop();
			console.log(`Stopped MongoDB`);
			callback();
		})();
	});

	process.env.masterStarted = "true";

	(async () => {
		console.log(`[Database] starting ...`);
		await mongod.start();
		console.log(`[Database] started`);
		process.env.MONGO_URL = mongod.getUri() + `&w=majority`;

		console.log(`Primary ${process.pid} is running`);

		// Fork workers.
		for (let i = 0; i < cores; i++) {
			cluster.fork();
		}

		cluster.on("exit", (worker: any, code: any, signal: any) => {
			console.log(`worker ${worker.process.pid} died, restart worker`);
			cluster.fork();
		});
	})();
} else {
	require("./server");
}
