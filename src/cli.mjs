#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {run} from './runner.mjs';

const {values}=parseArgs({options:{packet:{type:'string'},out:{type:'string'},
  live:{type:'boolean',default:false},web:{type:'boolean',default:false},
  'auth-path':{type:'string'},model:{type:'string',default:'deepseek-flash'},help:{type:'boolean'}}});
if(values.help||!values.packet||!values.out){
  console.log('Usage: node src/cli.mjs --packet /path/to/bundle.json --out /new/run/directory [--model deepseek-flash|gpt-6-sol] [--live] [--web] [--auth-path /private/pi/auth.json]\nDefault is offline preparation. --live authorizes export to the selected provider: DeepSeek Flash/max API or GPT-6 Sol/high via Pi ChatGPT-plan OAuth. --web uses the unmodified pi-web-access MCP server, fixed Exa backend.');
  process.exit(values.help?0:2);
}
try {console.log(JSON.stringify(await run({packetPath:values.packet,out:values.out,live:values.live,web:values.web,authPath:values['auth-path'],modelName:values.model})));}
catch(e){console.error(e.message);process.exitCode=1;}
