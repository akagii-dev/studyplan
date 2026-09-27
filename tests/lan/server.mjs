import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLanServer } from '../../scripts/lan-host.mjs';

const root = path.resolve('.');
const directory = path.join(root, '.test-data', 'lan-e2e');
await mkdir(directory, { recursive: true });
const databasePath = path.join(directory, 'studyplan.sqlite3');
// Only bootstrap the dedicated fixture. Subsequent operations use the shared Rust boundary.
const connection = new DatabaseSync(databasePath);
connection.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)))');
connection.prepare('INSERT OR IGNORE INTO state VALUES(1,1,?)').run(await readFile(path.join(root, 'src/domain/initialState.json'), 'utf8'));
connection.close();
const server = await createLanServer({
  root, databasePath, bridgePath: path.join(root, 'src-tauri/target/debug/studyplan_lan_bridge.exe'),
  host: '127.0.0.1', port: 4182, key: 'a'.repeat(64),
});
await writeFile(path.join(directory, 'test-server.json'), JSON.stringify({ databasePath }));
console.log('Isolated LAN test server ready on 4182');
const stop = async () => { await server.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
