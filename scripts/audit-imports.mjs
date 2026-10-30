import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
const root=path.resolve(process.argv[2]??process.cwd());
const require=createRequire(root+'/package.json');
const ts=process.argv[3]?require(path.resolve(process.argv[3])):require('typescript');
const files=[];
function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','.git','.wrangler','build'].includes(d.name))continue;const f=path.join(dir,d.name);if(d.isDirectory())walk(f);else if(/\.(ts|tsx|js|jsx|mjs|astro)$/.test(f)&&!f.endsWith('.d.ts'))files.push(f);}}
for(const folder of ['src','integrations','scripts'])walk(path.join(root,folder));
for(const name of fs.readdirSync(root))if(/\.(ts|mjs)$/.test(name))files.push(path.join(root,name));
const fileSet=new Set(files),edges=[],external=[],unresolved=[],assets=[];
const config=ts.readConfigFile(root+'/tsconfig.json',ts.sys.readFile);
const opts=ts.parseJsonConfigFileContent(config.config,ts.sys,root).options;
function resolve(spec,from){const r=ts.resolveModuleName(spec,from,opts,ts.sys).resolvedModule?.resolvedFileName;if(r&&fileSet.has(r))return r;if(spec.startsWith('.')){let b=path.resolve(path.dirname(from),spec);for(const s of ['', '.ts','.tsx','.js','.mjs','.astro','/index.ts','/index.tsx'])if(fileSet.has(b+s))return b+s;}return null;}
function scan(source,file,offset=0){const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function add(node,spec,kind){const target=resolve(spec,file);const line=source.slice(0,node.getStart(ast)).split('\n').length+offset;const edge={from:path.relative(root,file),to:target?path.relative(root,target):spec,spec,kind,line};if(target)edges.push(edge);else if(spec.startsWith('.')&&fs.existsSync(path.resolve(path.dirname(file),spec))&&/\.(css|svg|png|jpe?g|webp)$/.test(spec))assets.push(edge);else if(spec.startsWith('.'))unresolved.push(edge);else external.push(edge);}
 function visit(n){if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)){const c=n.importClause;const all=c?.namedBindings&&ts.isNamedImports(c.namedBindings)&&c.namedBindings.elements.length>0&&c.namedBindings.elements.every(x=>x.isTypeOnly);add(n,n.moduleSpecifier.text,c?.isTypeOnly||(!c?.name&&all)?'type':'runtime');}
 else if(ts.isExportDeclaration(n)&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier)){const all=n.exportClause&&ts.isNamedExports(n.exportClause)&&n.exportClause.elements.length>0&&n.exportClause.elements.every(x=>x.isTypeOnly);add(n,n.moduleSpecifier.text,n.isTypeOnly||all?'type':'runtime');}
 else if(ts.isCallExpression(n)&&n.arguments.length===1&&ts.isStringLiteral(n.arguments[0])&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(n.expression)&&n.expression.text==='require')))add(n,n.arguments[0].text,'runtime');
 else if(ts.isImportTypeNode(n)&&ts.isLiteralTypeNode(n.argument)&&ts.isStringLiteral(n.argument.literal))add(n,n.argument.literal.text,'type');
 ts.forEachChild(n,visit);}
 visit(ast);
}
for(const file of files){const source=fs.readFileSync(file,'utf8');if(!file.endsWith('.astro'))scan(source,file);else{const front=source.match(/^---\r?\n([\s\S]*?)\r?\n---/);if(front)scan(front[1],file,1);const re=/<script\b[^>]*>([\s\S]*?)<\/script>/g;let m;while(m=re.exec(source))scan(m[1],file,source.slice(0,m.index+m[0].indexOf('>')+1).split('\n').length-1);}}
const names=files.map(f=>path.relative(root,f));
function scc(selected){const adj=new Map(names.map(n=>[n,[]]));for(const e of selected)adj.get(e.from).push(e.to);let current=0;const idx=new Map(),low=new Map(),stack=[],on=new Set(),out=[];function visit(v){idx.set(v,current);low.set(v,current++);stack.push(v);on.add(v);for(const w of adj.get(v)){if(!idx.has(w)){visit(w);low.set(v,Math.min(low.get(v),low.get(w)));}else if(on.has(w))low.set(v,Math.min(low.get(v),idx.get(w)));}if(low.get(v)===idx.get(v)){const comp=[];let w;do{w=stack.pop();on.delete(w);comp.push(w);}while(w!==v);if(comp.length>1||adj.get(v).includes(v))out.push(comp.sort());}}for(const n of names)if(!idx.has(n))visit(n);return out;}
function layer(n){const p=n.split('/');if(p[0]!=='src')return p[0];if(p[1]==='server'&&p[2])return p[2].endsWith('.ts')?'server/root':'server/'+p[2];if(p[1]==='modules')return 'modules/'+p[2];return p[1];}
const runtimeCycles=scc(edges.filter(e=>e.kind==='runtime')),allCycles=scc(edges);
const matrix={};for(const e of edges){let a=layer(e.from),b=layer(e.to);if(a!==b)matrix[a+' -> '+b]=(matrix[a+' -> '+b]||0)+1;}
const ranked=names.map(n=>({file:n,lines:fs.readFileSync(root+'/'+n,'utf8').split('\n').length,imports:edges.filter(e=>e.from===n).length,importers:new Set(edges.filter(e=>e.to===n).map(e=>e.from)).size})).sort((a,b)=>b.imports-a.imports);
const crossBoundary=edges.filter(e=>(e.from.startsWith('src/shared/')&&e.to.startsWith('src/server/'))||(e.from.startsWith('src/modules/')&&/src\/(server|components)/.test(e.to))||(e.from.startsWith('src/components/')&&e.to.startsWith('src/server/')));
const output={root,method:'TypeScript AST import/export/require/dynamic-import/import-type + Astro frontmatter/script; TS resolver + explicit Astro path fallback',fileCount:files.length,edgeCount:edges.length,runtimeEdgeCount:edges.filter(e=>e.kind==='runtime').length,runtimeCycles,allCycles,crossBoundary,matrix,ranked,unresolved,assets,edges,external};
fs.writeFileSync(process.argv[4]??path.join(tmpdir(),'mademe-import-graph.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify({method:output.method,fileCount:output.fileCount,edgeCount:output.edgeCount,runtimeEdgeCount:output.runtimeEdgeCount,runtimeCycles,allCycles,cycleEdges:edges.filter(e=>allCycles.some(c=>c.includes(e.from)&&c.includes(e.to))),crossBoundary,ranked:ranked.slice(0,18),unresolved,matrix},null,2));
