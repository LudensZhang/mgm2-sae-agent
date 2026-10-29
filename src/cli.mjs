#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {run} from './runner.mjs';

const {values}=parseArgs({options:{packet:{type:'string'},out:{type:'string'},
  live:{type:'boolean',default:false},web:{type:'boolean',default:false},
  'auth-path':{type:'string'},help:{type:'boolean'}}});
if(values.help||!values.packet||!values.out){
  console.log('Usage: node src/cli.mjs --packet /path/to/bundle.json --out /new/run/directory [--live] [--web] [--auth-path /private/pi/auth.json]\nDefault is offline preparation. --live authorizes export of the anonymized evidence to official DeepSeek Flash (max). --web uses the unmodified pi-web-access MCP server, fixed Exa backend.');
  process.exit(values.help?0:2);
}
try {console.log(JSON.stringify(await run({packetPath:values.packet,out:values.out,live:values.live,web:values.web,authPath:values['auth-path']})));}
catch(e){console.error(e.message);process.exitCode=1;}
