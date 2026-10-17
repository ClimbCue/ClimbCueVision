export const NAMES = ['鼻尖','左眼内','左眼','左眼外','右眼内','右眼','右眼外','左耳','右耳','左嘴角','右嘴角','左肩','右肩','左肘','右肘','左腕','右腕','左小指','右小指','左食指','右食指','左拇指','右拇指','左髋','右髋','左膝','右膝','左踝','右踝','左脚跟','右脚跟','左脚尖','右脚尖'];
export const EDGES = [[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32],[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10]];
export const reliable = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && (p.visibility ?? 0) >= .5;
export function angle(a,b,c,width,height) {
  if (![a,b,c].every(reliable) || width <= 0 || height <= 0) return null;
  const u = [(a.x-b.x)*width,(a.y-b.y)*height];
  const v = [(c.x-b.x)*width,(c.y-b.y)*height];
  const size = Math.hypot(...u)*Math.hypot(...v);
  if (size < 1e-8) return null;
  return Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/size)))*180/Math.PI;
}
export function metrics(points=[],width,height) {
  const leftElbow=angle(points[11],points[13],points[15],width,height);
  const rightElbow=angle(points[12],points[14],points[16],width,height);
  const leftKnee=angle(points[23],points[25],points[27],width,height);
  const rightKnee=angle(points[24],points[26],points[28],width,height);
  let hip=null,tilt=null;
  if ([points[23],points[24]].every(reliable)) hip={x:(points[23].x+points[24].x)/2,y:(points[23].y+points[24].y)/2};
  if (hip && [points[11],points[12]].every(reliable)) {
    const dx=((points[11].x+points[12].x)/2-hip.x)*width;
    const dy=(hip.y-(points[11].y+points[12].y)/2)*height;
    if (Math.hypot(dx,dy)>1e-8) tilt=Math.atan2(Math.abs(dx),dy)*180/Math.PI;
  }
  return {leftElbow,rightElbow,leftKnee,rightKnee,hip,tilt,visible:points.filter(reliable).length};
}
export function toCSV(frames) {
  const header='frame,video_seconds,inference_ms,width,height,landmark_index,x,y,z,visibility,reliable,left_elbow_deg,right_elbow_deg,left_knee_deg,right_knee_deg,model,fixed_camera,center_proxy_x,center_proxy_y,hip_foot_offset_torso,left_hip_deg,right_hip_deg,left_shoulder_deg,right_shoulder_deg,left_ankle_deg,right_ankle_deg,left_arm_extension,right_arm_extension,left_leg_extension,right_leg_extension,hand_span_torso,foot_span_torso,center_speed_torso_s,vertical_speed_torso_s,lateral_range_torso,low_motion_seconds,movement,left_hand_near_hold,right_hand_near_hold,left_foot_near_hold,right_foot_near_hold';
  const rows=[header];
  for (const f of frames) {
    // Keep no-person frames in the export as explicit missing observations.
    const points=f.landmarks.length ? f.landmarks : [null];
    points.forEach((p,i)=>rows.push([f.frame,f.video_seconds,f.inference_ms,f.width,f.height,p?i:'',p?.x??'',p?.y??'',p?.z??'',p?.visibility??'',p?Number(reliable(p)):0,f.metrics.leftElbow??'',f.metrics.rightElbow??'',f.metrics.leftKnee??'',f.metrics.rightKnee??'',f.model??'',f.fixed_camera==null?'':Number(f.fixed_camera),f.climbing?.center?.x??'',f.climbing?.center?.y??'',...['hipFootOffset','leftHip','rightHip','leftShoulder','rightShoulder','leftAnkle','rightAnkle','leftArmExtension','rightArmExtension','leftLegExtension','rightLegExtension','handSpan','footSpan'].map(k=>f.climbing?.[k]??''),...['centerSpeed','verticalSpeed','lateralRange','stillSeconds','movement'].map(k=>f.motion?.[k]??''),...['leftHand','rightHand','leftFoot','rightFoot'].map(k=>f.proximity?.[k]?.id??'')].join(',')));
  }
  return rows.join('\n');
}
