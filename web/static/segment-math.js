// Normalized image polygons; measurements describe projected outlines, never contact.
export function contains(p, polygon) {
 let inside=false;
 for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const [x,y]=polygon[i],[a,b]=polygon[j];
  if((y>p.y)!==(b>p.y)&&p.x<(a-x)*(p.y-y)/(b-y)+x)inside=!inside;
 }
 return inside;
}
export function polygonInfo(polygon){
 const xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]);
 const bbox=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
 let twiceArea=0,cx=0,cy=0;
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length],cross=a[0]*b[1]-b[0]*a[1];
  twiceArea+=cross;cx+=(a[0]+b[0])*cross;cy+=(a[1]+b[1])*cross;
 }
 let center={x:cx/(3*twiceArea),y:cy/(3*twiceArea)};
 // A concave outline's centroid can fall outside. Pick an interior scanline interval.
 if(!Number.isFinite(center.x)||!contains(center,polygon)){
  let best=-1;
  for(let row=0;row<33;row++){
   const y=bbox[1]+(row+.5)/33*(bbox[3]-bbox[1]),hits=[];
   for(let i=0;i<polygon.length;i++){
    const [x1,y1]=polygon[i],[x2,y2]=polygon[(i+1)%polygon.length];
    if((y1>y)!==(y2>y))hits.push(x1+(y-y1)*(x2-x1)/(y2-y1));
   }
   hits.sort((a,b)=>a-b);
   for(let i=0;i+1<hits.length;i+=2)if(hits[i+1]-hits[i]>best){best=hits[i+1]-hits[i];center={x:(hits[i]+hits[i+1])/2,y};}
  }
 }
 return {bbox,area_fraction:Math.abs(twiceArea)/2,center};
}
export function polygonDistance(p,polygon,w,h){
 if(contains(p,polygon))return 0;
 let best=Infinity;
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length];
  const dx=(b[0]-a[0])*w,dy=(b[1]-a[1])*h,px=(p.x-a[0])*w,py=(p.y-a[1])*h;
  const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy)||0));
  best=Math.min(best,Math.hypot(px-t*dx,py-t*dy));
 }
 return best;
}
