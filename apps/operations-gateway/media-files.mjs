import {lstat,realpath} from 'node:fs/promises';
import {basename,resolve,dirname,extname} from 'node:path';
export const imageExtensions=new Set(['.jpg','.jpeg','.png','.webp','.gif','.avif','.heic','.heif']);
export const mediaExtensions=new Set([...imageExtensions,'.mp4','.mov','.m4v','.webm']);
export function safeStoredMediaName(name){return typeof name==='string'&&name.length<=220&&name.length>0&&basename(name)===name&&!/[\\/\x00-\x1f:]/.test(name)&&mediaExtensions.has(extname(name).toLowerCase());}
export async function resolveMaterialBatch(root,platform,names){
 if(!['xiaohongshu','douyin'].includes(platform)||!Array.isArray(names)||names.length<1||names.length>100||new Set(names).size!==names.length||!names.every(safeStoredMediaName))throw new Error('Invalid media selection');
 const directory=await realpath(resolve(root,platform));
 for(const name of names){const file=resolve(directory,name),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||dirname(await realpath(file))!==directory||info.size<1)throw new Error('Invalid media file');}
 return names;
}
