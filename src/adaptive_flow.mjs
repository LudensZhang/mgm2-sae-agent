// Three logical agents; interpreter and reviewer retain their own sessions.
// Invoker owns provider calls. This state machine is independently testable offline.
export async function adaptiveFlow({invoke,record=async()=>{},maxResearch=2,maxRevisions=1}) {
  let candidate,researchCount=0,revisions=0;
  const research=[];
  async function interpret(input) {
    let action=await invoke('interpret',input);
    while(action.kind==='research_request') {
      await record(`research_request_${researchCount+1}`,action.request);
      if(researchCount>=maxResearch) {
        // No silent inference of success, extra calls or automatic retry.
        return {unresolved:true,request:action.request};
      }
      researchCount++;
      const result=await invoke('research',{request:action.request});
      if(result.kind!=='research_result')throw new Error('Expected research result');
      research.push(result.report);
      await record(`research_result_${researchCount}`,result.report);
      action=await invoke('interpret',{research_result:result.report});
    }
    if(action.kind!=='candidate')throw new Error('Expected candidate interpretation');
    candidate=action.report;
    await record(`candidate_${revisions}`,candidate);
    return {unresolved:false};
  }
  let state=await interpret({initial:true});
  if(state.unresolved)return {status:'needs_review',candidate:null,review:null,research,researchCount,revisions,
    reason:'Additional research requested beyond the authorized pilot limit',pending_request:state.request};
  while(true) {
    const result=await invoke('review',{candidate});
    if(result.kind!=='review')throw new Error('Expected independent review');
    const review=result.report;await record(`review_${revisions}`,review);
    if(review.verdict==='supported')return {status:'complete',candidate,review,research,researchCount,revisions};
    if(review.verdict==='insufficient'||revisions>=maxRevisions)
      return {status:'needs_review',candidate,review,research,researchCount,revisions,
        reason:review.verdict==='insufficient'?'Evidence insufficient for the proposed explanation':'Unresolved review after the authorized revision'};
    if(review.verdict!=='revise')throw new Error('Unknown review verdict');
    revisions++;
    state=await interpret({review});
    if(state.unresolved)return {status:'needs_review',candidate,review,research,researchCount,revisions,
      reason:'Additional research requested beyond the authorized pilot limit',pending_request:state.request};
  }
}
