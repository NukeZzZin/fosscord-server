// process.env.MONGOMS_DEBUG = "1";
import fs from "fs";
import { MongoBinary } from "mongodb-memory-server-global-4.4";
import path from "path";
import cluster from "cluster";
import os from "os";
import osu from "node-os-utils";
import exitHook from "async-exit-hook";
import mongoose from "mongoose";
import { exec, ChildProcess } from "child_process";

const cores = Number(process.env.threads) || 1 || os.cpus().length;

if (cluster.isMaster && !process.env.masterStarted) {
	const dbPath = path.join(__dirname, "..", "data", "db");
	const dbName = "fosscord";
	const storageEngine = "wiredTiger";
	const port = 27020;
	const host = "127.0.0.1";
	var mongod: ChildProcess;
	fs.mkdirSync(dbPath, { recursive: true });

	const replSet = "rs0";

	exitHook((callback) => {
		(async () => {
			console.log(`Stopping MongoDB ...`);
			mongod.kill();
			console.log(`Stopped MongoDB`);
			callback();
			process.exit(0);
		})();
	});

	process.env.masterStarted = "true";

	setInterval(async () => {
		const [cpuUsed, memory, network] = await Promise.all([osu.cpu.usage(), osu.mem.info(), osu.netstat.inOut()]);
		if (typeof network === "object") {
			console.log(`Network: in ${network.total.inputMb}mb | out ${network.total.outputMb}mb`);
		}

		console.log(
			`[CPU] ${cpuUsed.toFixed(2)}% | [Memory] ${memory.usedMemMb.toFixed(0)}mb/${memory.totalMemMb.toFixed(0)}mb`
		);
	}, 1000 * 60);

	(async () => {
		const binary = await MongoBinary.getPath();
		mongod = exec(`${binary} --replSet ${replSet} --port ${port} --bind_ip ${host} --dbpath "${dbPath}"`);
		console.log(`[Database] starting ...`);
		process.env.MONGO_URL = `mongodb://${host}:${port}/${dbName}`;

		const conn = mongoose.createConnection(process.env.MONGO_URL, {
			useNewUrlParser: true,
			useUnifiedTopology: true,
		});

		await new Promise((resolve, reject) => {
			conn.once("open", resolve);
		});
		await conn.db
			.admin()
			.command({
				replSetInitiate: 1,
			})
			.catch((e) => {});

		mongod.stderr?.on("data", (data) => {
			console.error(data);
		});

		mongod.stdout?.on("data", (data) => {
			data.split("\n").forEach((x: any) => {
				if (!x) return;
				try {
					const { msg } = JSON.parse(x);
					// console.log(msg);
				} catch (error) {}
			});
		});

		console.log(`[CPU] ${osu.cpu.model()} Cores x${osu.cpu.count()}`);
		console.log(`[System] ${await osu.os.oos()} ${os.arch()}`);
		console.log(`[Database] started`);
		console.log(`[Process] running with pid: ${process.pid}`);

		// Fork workers.
		for (let i = 0; i < cores; i++) {
			cluster.fork();
		}

		cluster.on("exit", (worker: any, code: any, signal: any) => {
			console.log(`[Worker] died with pid: ${worker.process.pid} , restarting ...`);
			cluster.fork();
		});
	})();
} else {
	require("./server");
}
