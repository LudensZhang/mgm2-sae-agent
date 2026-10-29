import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {json} from './core.mjs';

function packageRoot(name,from=import.meta.url) {
  // Pi exports are ESM-only; require.resolve(name) cannot resolve its import condition.
  for(const base of createRequire(from).resolve.paths(name)??[]) {
    const root=join(base,name);
    if(existsSync(join(root,'package.json')))return root;
  }
  throw new Error('Package not found: '+name);
}

export function packageLocation() {
  if(process.env.SAE_PI_PACKAGE) return process.env.SAE_PI_PACKAGE;
  try { return packageRoot('@earendil-works/pi-coding-agent'); }
  catch {
    const installed=join(homedir(),'anaconda3/envs/claude-code/lib/node_modules/@earendil-works/pi-coding-agent');
    if(existsSync(join(installed,'package.json'))) return installed;
    throw new Error('Install the pinned Pi dependency or set SAE_PI_PACKAGE to an existing Pi package directory');
  }
}

export async function loadPi() {
  const path=packageLocation(), pkg=await json(join(path,'package.json'));
  if(pkg.version!=='1.4.0') throw new Error(`Expected Pi 1.4.0; found ${pkg.version}. Validate compatibility before changing the pin.`);
  const require=createRequire(join(path,'package.json'));
  return {path,version:pkg.version,sdk:await import(pathToFileURL(join(path,'dist/index.js'))),
    ai:await import(pathToFileURL(join(packageRoot('@earendil-works/pi-ai',join(path,'package.json')),'dist/index.js'))),
    Type:(await import(pathToFileURL(require.resolve('typebox')))).Type};
}

export async function deepseekRuntime(pi, {authPath, modelId='deepseek-flash'}) {
  const credentials=new pi.ai.InMemoryCredentialStore();
  let key=process.env.DEEPSEEK_API_KEY;
  if(!key) {
    const stored=await json(authPath??join(homedir(),'.pi/agent/auth.json'));
    const credential=stored.deepseek;
    if(credential?.type!=='api_key'||typeof credential.key!=='string'||credential.key.startsWith('!'))
      throw new Error('A direct DeepSeek API key is required. No command execution, OAuth, gateway or Bailian fallback.');
    key=credential.key;
  }
  if(!key?.trim()) throw new Error('Missing DeepSeek credential');
  await credentials.modify('deepseek',async()=>({type:'api_key',key}));
  const runtime=await pi.sdk.ModelRuntime.create({credentials,modelsPath:null,
    modelsStore:new pi.ai.InMemoryModelsStore(),allowModelNetwork:false});
  const model=runtime.getModel('deepseek',modelId);
  if(!model||model.provider!=='deepseek'||new URL(model.baseUrl).hostname!=='api.deepseek.com')
    throw new Error('Exact official DeepSeek model unavailable; no model substitution');
  return {runtime,model,redact:s=>String(s).split(key).join('[REDACTED]')};
}

export async function skillText(root) {
  return (await Promise.all(['sae-interpretation','source-grounding'].map(name=>
    readFile(join(root,'skills',name,'SKILL.md'),'utf8')))).join('\n\n');
}

export function resourceLoader(pi, systemPrompt) {
  return {
    getExtensions:()=>({extensions:[],errors:[],runtime:pi.sdk.createExtensionRuntime()}),
    getSkills:()=>({skills:[],diagnostics:[]}), getPrompts:()=>({prompts:[],diagnostics:[]}),
    getThemes:()=>({themes:[],diagnostics:[]}), getAgentsFiles:()=>({agentsFiles:[]}),
    getSystemPrompt:()=>systemPrompt, getSystemPromptSource:()=>undefined,
    getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],
    extendResources:()=>{},reload:async()=>{},
  };
}
