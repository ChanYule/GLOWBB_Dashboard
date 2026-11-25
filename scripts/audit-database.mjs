import {readdir,readFile,writeFile} from 'node:fs/promises';
const modules=[];
for(const file of (await readdir(new URL('../server/',import.meta.url))).filter(f=>f.endsWith('.js')).sort()){
 const text=await readFile(new URL('../server/'+file,import.meta.url),'utf8');
 const routes=[...text.matchAll(/app\.(get|post|put|delete)\(\s*(['"`])([^'"`]+?)\2/g)].map(m=>({method:m[1].toUpperCase(),path:m[3],line:text.slice(0,m.index).split('\n').length}));
 const statements=[...text.matchAll(/\.(?:prepare|query)\(\s*(['"`])([\s\S]*?)\1/g)].map(m=>m[2].replace(/\s+/g,' ').slice(0,300));
 if(routes.length||statements.length)modules.push({file:'server/'+file,routes,literalSqlPrefixes:statements,fullStateReadReferences:(text.match(/\b(?:readData|readPlanningState|readEffectiveData|configurationState)\(/g)||[]).length});
}
const value={scope:'Static source inventory of literal Express routes and SQL prefixes; dynamic queries are described in EGRESS-OPTIMISATION.md. No credentials, records or database connections are read. Frequency/rows/bytes require runtime measurements; this inventory does not guess production traffic.',modules};
await writeFile(new URL('../docs/database-request-inventory.json',import.meta.url),JSON.stringify(value,null,2)+'\n');
console.log(`${modules.length} database/API modules; ${modules.reduce((n,m)=>n+m.routes.length,0)} literal routes inventoried.`);
