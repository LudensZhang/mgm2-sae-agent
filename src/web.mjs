import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {json, save, checkPrivacy} from './core.mjs';

// Reuse the installed plugin verbatim through its documented MCP interface.
// Do not import its Pi extension or mutate the user's plugin/configuration.
export async function openWeb(runtimeDir) {
  const plugin=process.env.SAE_WEB_PACKAGE??join(homedir(),'.pi/agent/npm/node_modules/pi-web-access');
  const pkg=await json(join(plugin,'package.json'));
  if(pkg.version!=='0.45.0') throw new Error('Expected pi-web-access 0.45.0; validate before changing the pin');
  const require=createRequire(join(plugin,'package.json'));
  const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
  const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
  await mkdir(runtimeDir,{recursive:true});
  await save(join(runtimeDir,'web-search.json'),{
    provider:'exa',workflow:'none',allowBrowserCookies:false,maxInlineContentChars:7000,
    fetch:{timeout:20},fetchRouting:{allowRemoteHostedProviders:false},
    pdf:{provider:'unpdf',maxSizeMB:10,maxPages:30},
  });
  const env={PATH:process.env.PATH,HOME:homedir(),PI_CODING_AGENT_DIR:runtimeDir};
  // One explicit optional search key; never inherit other model-provider secrets.
  if(process.env.EXA_API_KEY) env.EXA_API_KEY=process.env.EXA_API_KEY;
  const transport=new StdioClientTransport({command:process.execPath,
    args:[join(plugin,'dist/mcp-cli.js')],env,stderr:'pipe'});
  const client=new Client({name:'mgm2-sae-agent',version:'0.1.0'});
  try { await client.connect(transport); }
  catch(error) {await transport.close();throw error;}
  // Consume diagnostics, but never echo unknown plugin output/credentials.
  transport.stderr?.on('data',()=>{});
  return {version:pkg.version,close:()=>client.close(),call:async(name,args,signal)=>{
    checkPrivacy(args);
    return client.callTool({name,arguments:args},undefined,{signal,timeout:60000});
  }};
}

export function publicUrl(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'
    ||url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local')
    ||!url.hostname.includes('.')||/^\d+(\.\d+){3}$/.test(url.hostname)||url.hostname.includes(':'))
    throw new Error('Public HTTPS hostname required');
  // Plugin also checks DNS resolutions and redirects for SSRF.
  return url.href;
}

// Preserve exact source snapshots on disk; only redact the model-facing slice.
// Publisher navigation such as /home/journal is indistinguishable from local
// paths to the strict outbound gate. Public accessions are unnecessary here too.
// Offsets and hashes continue to refer to the immutable original source text.
export function sourceForModel(record) {
  if(typeof record?.text!=='string')return record;
  let count=0;
  const text=record.text.replace(/\b(?:PRJ[END][AB]\d+|[SED]R[RSXP]\d+|SAM[END][AG]?\d+)\b/gi,()=>{
    count++;return '[ACCESSION_REDACTED]';
  }).replace(/\/(?:home|data\d+|Users)\/[^\s"'<>\\]*/g,()=>{
    count++;return '[PATH_REDACTED]';
  });
  return {...record,text,model_text_redactions:count,
    text_provenance:'Model-facing slice; path/accession redactions marked. Original text, offsets and hash retained in host archive.'};
}

export function webTools(Type, {bridge,archive,budget,role,readSources}) {
  const output=r=>({content:[{type:'text',text:JSON.stringify(sourceForModel(r))}],details:{}});
  const tools=[
    {name:'source_list',label:'Source archive',description:'List exact cached retrieval snapshots and their coverage.',
      parameters:Type.Object({}),execute:async()=>output(archive.list())},
    {name:'source_read',label:'Read source',description:'Read original cached plugin text; reuse across roles without another web request.',
      parameters:Type.Object({id:Type.String(),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:7000}))}),
      execute:async(_id,p)=>{const result=archive.read(p.id,p.offset,p.limit);readSources.add(p.id);return output(result);}},
  ];
  if(role!=='literature'||!bridge) return tools;
  tools.push(
    {name:'literature_search',label:'Literature search',description:'Search using the same fixed Exa backend for every model. Raw results, no secondary LLM. Search snippets are not full text.',
      parameters:Type.Object({query:Type.String({minLength:3,maxLength:500})}),
      execute:async(_id,p,signal)=>{
        checkPrivacy(p); const request={query:p.query,provider:'exa',numResults:5,includeContent:false};
        let record=archive.cached('search',request);
        if(!record){budget.take('searches',role);record=await archive.add('search',request,await bridge.call('web_search',request,signal));}
        readSources.add(record.id);return output(archive.read(record.id));
      }},
    {name:'source_fetch',label:'Open source',description:'Open a public source through unmodified pi-web-access; archive returned extract once. Not guaranteed to be the complete article.',
      parameters:Type.Object({url:Type.String({maxLength:2000})}),
      execute:async(_id,p,signal)=>{
        const request={url:publicUrl(p.url),mode:'readable'};
        let record=archive.cached('fetch',request);
        if(!record){budget.take('fetches',role);record=await archive.add('fetch',request,await bridge.call('fetch_content',request,signal));}
        readSources.add(record.id);return output(archive.read(record.id));
      }},
    {name:'source_more',label:'Read more web content',description:'Read additional cached plugin content using a responseId from a prior web result. No new search. Returned slice receives its own source ID.',
      parameters:Type.Object({parent_source_id:Type.String(),responseId:Type.String({maxLength:150}),url:Type.Optional(Type.String({maxLength:2000})),
        offset:Type.Optional(Type.Integer({minimum:0})),findText:Type.Optional(Type.String({maxLength:300}))}),
      execute:async(_id,p,signal)=>{
        const parent=archive.records.get(p.parent_source_id);
        if(!parent||!parent.text.includes(p.responseId)||parent.is_error)throw new Error('responseId must originate in a successful archived parent');
        if(p.url)publicUrl(p.url);const {parent_source_id,...params}=p;
        const request={...params,limit:7000},cacheKey={parent_source_id,...request};
        const kind=['fetch','fetch_slice'].includes(parent.kind)?'fetch_slice':'search_slice';
        let record=archive.cached(kind,cacheKey);
        if(!record){budget.take('slices',role);record=await archive.add(kind,cacheKey,await bridge.call('get_search_content',request,signal));}
        readSources.add(record.id);return output(archive.read(record.id));
      }},
  );
  return tools;
}
