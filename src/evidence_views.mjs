// Lossless transport views, not an LLM summary or a selected feature label.
// Repeated column names and interpretation strings are transmitted once per table.
export function packRecords(records){
  const tables=[],objects={};
  for(const [id,record] of Object.entries(records)){
    if(record && Object.keys(record).length===2 && Object.hasOwn(record,'value') &&
      typeof record.interpretation==='string' && record.value && !Array.isArray(record.value) &&
      typeof record.value==='object' && Object.values(record.value).every(v=>v===null||['string','number','boolean'].includes(typeof v))){
      const columns=Object.keys(record.value);
      let table=tables.find(t=>t.interpretation===record.interpretation&&JSON.stringify(t.columns)===JSON.stringify(columns));
      if(!table){table={columns,interpretation:record.interpretation,rows:[]};tables.push(table);}
      table.rows.push([id,...columns.map(c=>record.value[c])]);
    }else objects[id]=record;
  }
  return {format:'lossless_tables_v1',row_format:'[evidence_id, ...values in columns order]; each row has the table interpretation. Objects are unchanged records.',tables,objects};
}

export function unpackRecords(view){
  const records={...view.objects};
  for(const t of view.tables)for(const [id,...values] of t.rows)
    records[id]={value:Object.fromEntries(t.columns.map((c,i)=>[c,values[i]])),interpretation:t.interpretation};
  return records;
}

export function selectBrief(packet){
  // Include ALL exported summary records; never select on a desired interpretation.
  // Case annexes and analyses outside E.* remain accessible through exact IDs.
  return Object.fromEntries(Object.entries(packet.records).filter(([id])=>id.startsWith('E.')&&!id.startsWith('E.case.')));
}

export function readMany(packet,ids,{maxChars=18000}={}){
  if(!Array.isArray(ids)||!ids.length||ids.length>64||new Set(ids).size!==ids.length)
    throw new Error('Request 1–64 unique evidence IDs');
  const selected={};let packed=packRecords(selected),i=0;
  for(const id of ids){
    if(!Object.hasOwn(packet.records,id))throw new Error('Unknown evidence id: '+id);
  }
  for(const id of ids){
    const next=packRecords({...selected,[id]:packet.records[id]});
    if(JSON.stringify(next).length>maxChars)break;
    selected[id]=packet.records[id];packed=next;i++;
  }
  // No silently clipped numeric records; oversized single records use pointer/pagination.
  return {...packed,read_ids:Object.keys(selected),remaining_ids:ids.slice(i),
    note:i<ids.length?'Remaining IDs were NOT read; use evidence_read with pointer/pagination for oversized records, or another batch.':'All requested records included exactly.'};
}
