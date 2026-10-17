import { mkdir, copyFile, cp, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = resolve(root, 'web/static/vendor');
const models = resolve(root, 'web/static/models');
await mkdir(vendor, { recursive: true });
await mkdir(models, { recursive: true });
await copyFile(resolve(root, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'), resolve(vendor, 'vision_bundle.mjs'));
await cp(resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm'), resolve(vendor, 'wasm'), { recursive: true });
const manifest=[];
for(const [variant,expected] of [
 ['lite','59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'],
 ['full','5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1'],
 ['heavy','64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b']
]){
 const url=`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`;
 const path=resolve(models,`pose_landmarker_${variant}.task`);
 let bytes;
 try{bytes=await readFile(path);}catch{
  console.log(`Downloading official MediaPipe Pose Landmarker ${variant}…`);
  const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error(`Model download: HTTP ${response.status}`);
  bytes=Buffer.from(await response.arrayBuffer());
 }
 const sha256=createHash('sha256').update(bytes).digest('hex');
 if(sha256!==expected)throw new Error(`${variant} checksum mismatch; remove the local .task file and download again.`);
 await writeFile(path,bytes);
 manifest.push({model:`pose_landmarker_${variant}`,version:1,url,bytes:bytes.length,sha256});
 console.log(`Local ${variant} ready (${bytes.length} bytes).`);
}
await writeFile(resolve(models,'manifest.json'),JSON.stringify({models:manifest},null,2));
