// Windows can allocate ports that Fetch intentionally blocks when listen(0) is used.
export async function listenForHttpTest(server){
  for(let port=49152;port<49700;port++){
    const opened=await new Promise((resolve,reject)=>{
      const error=e=>{server.removeListener('listening',ready);if(e.code==='EADDRINUSE')resolve(false);else reject(e);};
      const ready=()=>{server.removeListener('error',error);resolve(true);};
      server.once('error',error);server.once('listening',ready);server.listen(port,'127.0.0.1');
    });if(opened)return;
  }throw Error('No free HTTP test port');
}
