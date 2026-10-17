import { FilesetResolver, PoseLandmarker } from '/static/vendor/vision_bundle.mjs';
let model,serverModel;
async function responseJSON(response){const data=await response.json();if(!response.ok)throw new Error(data.detail||`HTTP ${response.status}`);return data;}
self.onmessage=async ({data})=>{
  if(data.type==='init'){
    try {
      if(!['lite','full','heavy'].includes(data.model)){
        serverModel=data.model;
        await responseJSON(await fetch(`/api/models/${encodeURIComponent(serverModel)}/load`,{method:'POST',signal:AbortSignal.timeout(120000)}));
        self.postMessage({type:'ready'});return;
      }
      const vision=await FilesetResolver.forVisionTasks('/static/vendor/wasm', true);
      model=await PoseLandmarker.createFromOptions(vision,{
        baseOptions:{modelAssetPath:`/static/models/pose_landmarker_${data.model}.task`,delegate:'CPU'},
        runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5,
      });
      self.postMessage({type:'ready'});
    }catch(error){self.postMessage({type:'error',message:String(error)});}
  }else if(data.type==='frame'){
    try{
      const start=performance.now();
      if(serverModel){
        const surface=new OffscreenCanvas(data.bitmap.width,data.bitmap.height);
        surface.getContext('2d').drawImage(data.bitmap,0,0);
        const body=await surface.convertToBlob({type:'image/jpeg',quality:.9});
        const result=await responseJSON(await fetch(`/api/models/${encodeURIComponent(serverModel)}/infer`,{method:'POST',body,signal:AbortSignal.timeout(120000)}));
        self.postMessage({...result,type:'result',session:data.session,sequence:data.sequence,time:data.time,roundtrip_ms:performance.now()-start,bitmap:data.bitmap},[data.bitmap]);return;
      }
      const result=model.detectForVideo(data.bitmap,data.timestamp);
      self.postMessage({type:'result',session:data.session,sequence:data.sequence,time:data.time,
        landmarks:result.landmarks[0]??[],inference_ms:performance.now()-start,bitmap:data.bitmap},[data.bitmap]);
    }catch(error){data.bitmap.close();self.postMessage({type:'error',session:data.session,message:String(error)});}
  }
};
