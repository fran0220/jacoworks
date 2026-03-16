var mr=Object.defineProperty;var gr=(t,e,n)=>e in t?mr(t,e,{enumerable:!0,configurable:!0,writable:!0,value:n}):t[e]=n;var ye=(t,e,n)=>gr(t,typeof e!="symbol"?e+"":e,n);import{U as Re}from"./three.module-a3_FgucU.js";import{a6 as _r,a7 as gt,a8 as ai,a9 as vr,aa as Ie,ab as li,ac as Y,a as ae,j as O,n as Z,c as Oe,ad as Mr,H as Tr,z as xr,ae as F,V as v,af as yr,Q as A,ag as Rr,ah as ve,ai as wr,aj as Er,u as U,ak as Lt,al as ui,am as Sr,an as Ar,ao as Lr,L as _t,ap as ci,aq as vt,ar as Pr,as as br,at as Ir,r as ke,au as Ne,Z as je,l as Mt,av as le,aw as Or,t as K,ax as di,i as ue,Y as Ze,ay as hi,az as Nr,aA as Cr,I as q,q as Ur,b as N,O as Vr,aB as $e,aC as Dr,aD as Fr,aE as Br,aF as fi,aG as Pt,s as hn,aH as fn,aI as pn,aJ as mn,aK as gn,F as Hr,aL as kr,aM as Wr,aN as Gr,k as zr,aO as bt,aP as jr,m as Xr,aQ as qr,aR as Yr,aS as j,aT as Kr,aU as _n,aV as Qr,p as Xe,aW as Zr,_ as $r}from"./three.core-C-ddYjFW.js";import{g as vn}from"./AgentObservatory-Bn7w0qux.js";import"../chat.js";function Mn(t,e){if(e===_r)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),t;if(e===gt||e===ai){let n=t.getIndex();if(n===null){const o=[],l=t.getAttribute("position");if(l!==void 0){for(let a=0;a<l.count;a++)o.push(a);t.setIndex(o),n=t.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),t}const i=n.count-2,r=[];if(e===gt)for(let o=1;o<=i;o++)r.push(n.getX(0)),r.push(n.getX(o)),r.push(n.getX(o+1));else for(let o=0;o<i;o++)o%2===0?(r.push(n.getX(o)),r.push(n.getX(o+1)),r.push(n.getX(o+2))):(r.push(n.getX(o+2)),r.push(n.getX(o+1)),r.push(n.getX(o)));r.length/3!==i&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");const s=t.clone();return s.setIndex(r),s.clearGroups(),s}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),t}function Jr(t){const e=new Map,n=new Map,i=t.clone();return pi(t,i,function(r,s){e.set(s,r),n.set(r,s)}),i.traverse(function(r){if(!r.isSkinnedMesh)return;const s=r,o=e.get(r),l=o.skeleton.bones;s.skeleton=o.skeleton.clone(),s.bindMatrix.copy(o.bindMatrix),s.skeleton.bones=l.map(function(a){return n.get(a)}),s.bind(s.skeleton,s.bindMatrix)}),i}function pi(t,e,n){n(t,e);for(let i=0;i<t.children.length;i++)pi(t.children[i],e.children[i],n)}class es extends vr{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(n){return new ss(n)}),this.register(function(n){return new os(n)}),this.register(function(n){return new ms(n)}),this.register(function(n){return new gs(n)}),this.register(function(n){return new _s(n)}),this.register(function(n){return new ls(n)}),this.register(function(n){return new us(n)}),this.register(function(n){return new cs(n)}),this.register(function(n){return new ds(n)}),this.register(function(n){return new rs(n)}),this.register(function(n){return new hs(n)}),this.register(function(n){return new as(n)}),this.register(function(n){return new ps(n)}),this.register(function(n){return new fs(n)}),this.register(function(n){return new ns(n)}),this.register(function(n){return new Tn(n,E.EXT_MESHOPT_COMPRESSION)}),this.register(function(n){return new Tn(n,E.KHR_MESHOPT_COMPRESSION)}),this.register(function(n){return new vs(n)})}load(e,n,i,r){const s=this;let o;if(this.resourcePath!=="")o=this.resourcePath;else if(this.path!==""){const u=Ie.extractUrlBase(e);o=Ie.resolveURL(u,this.path)}else o=Ie.extractUrlBase(e);this.manager.itemStart(e);const l=function(u){r?r(u):console.error(u),s.manager.itemError(e),s.manager.itemEnd(e)},a=new li(this.manager);a.setPath(this.path),a.setResponseType("arraybuffer"),a.setRequestHeader(this.requestHeader),a.setWithCredentials(this.withCredentials),a.load(e,function(u){try{s.parse(u,o,function(c){n(c),s.manager.itemEnd(e)},l)}catch(c){l(c)}},i,l)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,n,i,r){let s;const o={},l={},a=new TextDecoder;if(typeof e=="string")s=JSON.parse(e);else if(e instanceof ArrayBuffer)if(a.decode(new Uint8Array(e,0,4))===mi){try{o[E.KHR_BINARY_GLTF]=new Ms(e)}catch(d){r&&r(d);return}s=JSON.parse(o[E.KHR_BINARY_GLTF].content)}else s=JSON.parse(a.decode(e));else s=e;if(s.asset===void 0||s.asset.version[0]<2){r&&r(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}const u=new Os(s,{path:n||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});u.fileLoader.setRequestHeader(this.requestHeader);for(let c=0;c<this.pluginCallbacks.length;c++){const d=this.pluginCallbacks[c](u);d.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),l[d.name]=d,o[d.name]=!0}if(s.extensionsUsed)for(let c=0;c<s.extensionsUsed.length;++c){const d=s.extensionsUsed[c],h=s.extensionsRequired||[];switch(d){case E.KHR_MATERIALS_UNLIT:o[d]=new is;break;case E.KHR_DRACO_MESH_COMPRESSION:o[d]=new Ts(s,this.dracoLoader);break;case E.KHR_TEXTURE_TRANSFORM:o[d]=new xs;break;case E.KHR_MESH_QUANTIZATION:o[d]=new ys;break;default:h.indexOf(d)>=0&&l[d]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+d+'".')}}u.setExtensions(o),u.setPlugins(l),u.parse(i,r)}parseAsync(e,n){const i=this;return new Promise(function(r,s){i.parse(e,n,r,s)})}}function ts(){let t={};return{get:function(e){return t[e]},add:function(e,n){t[e]=n},remove:function(e){delete t[e]},removeAll:function(){t={}}}}function C(t,e,n){const i=t.json.materials[e];return i.extensions&&i.extensions[n]?i.extensions[n]:null}const E={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",KHR_MESHOPT_COMPRESSION:"KHR_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"};class ns{constructor(e){this.parser=e,this.name=E.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){const e=this.parser,n=this.parser.json.nodes||[];for(let i=0,r=n.length;i<r;i++){const s=n[i];s.extensions&&s.extensions[this.name]&&s.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,s.extensions[this.name].light)}}_loadLight(e){const n=this.parser,i="light:"+e;let r=n.cache.get(i);if(r)return r;const s=n.json,a=((s.extensions&&s.extensions[this.name]||{}).lights||[])[e];let u;const c=new O(16777215);a.color!==void 0&&c.setRGB(a.color[0],a.color[1],a.color[2],Z);const d=a.range!==void 0?a.range:0;switch(a.type){case"directional":u=new xr(c),u.target.position.set(0,0,-1),u.add(u.target);break;case"point":u=new Tr(c),u.distance=d;break;case"spot":u=new Mr(c),u.distance=d,a.spot=a.spot||{},a.spot.innerConeAngle=a.spot.innerConeAngle!==void 0?a.spot.innerConeAngle:0,a.spot.outerConeAngle=a.spot.outerConeAngle!==void 0?a.spot.outerConeAngle:Math.PI/4,u.angle=a.spot.outerConeAngle,u.penumbra=1-a.spot.innerConeAngle/a.spot.outerConeAngle,u.target.position.set(0,0,-1),u.add(u.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+a.type)}return u.position.set(0,0,0),X(u,a),a.intensity!==void 0&&(u.intensity=a.intensity),u.name=n.createUniqueName(a.name||"light_"+e),r=Promise.resolve(u),n.cache.add(i,r),r}getDependency(e,n){if(e==="light")return this._loadLight(n)}createNodeAttachment(e){const n=this,i=this.parser,s=i.json.nodes[e],l=(s.extensions&&s.extensions[this.name]||{}).light;return l===void 0?null:this._loadLight(l).then(function(a){return i._getNodeRef(n.cache,l,a)})}}class is{constructor(){this.name=E.KHR_MATERIALS_UNLIT}getMaterialType(){return le}extendParams(e,n,i){const r=[];e.color=new O(1,1,1),e.opacity=1;const s=n.pbrMetallicRoughness;if(s){if(Array.isArray(s.baseColorFactor)){const o=s.baseColorFactor;e.color.setRGB(o[0],o[1],o[2],Z),e.opacity=o[3]}s.baseColorTexture!==void 0&&r.push(i.assignTexture(e,"map",s.baseColorTexture,Oe))}return Promise.all(r)}}class rs{constructor(e){this.parser=e,this.name=E.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);return i===null||i.emissiveStrength!==void 0&&(n.emissiveIntensity=i.emissiveStrength),Promise.resolve()}}class ss{constructor(e){this.parser=e,this.name=E.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){return C(this.parser,e,this.name)!==null?Y:null}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);if(i===null)return Promise.resolve();const r=[];if(i.clearcoatFactor!==void 0&&(n.clearcoat=i.clearcoatFactor),i.clearcoatTexture!==void 0&&r.push(this.parser.assignTexture(n,"clearcoatMap",i.clearcoatTexture)),i.clearcoatRoughnessFactor!==void 0&&(n.clearcoatRoughness=i.clearcoatRoughnessFactor),i.clearcoatRoughnessTexture!==void 0&&r.push(this.parser.assignTexture(n,"clearcoatRoughnessMap",i.clearcoatRoughnessTexture)),i.clearcoatNormalTexture!==void 0&&(r.push(this.parser.assignTexture(n,"clearcoatNormalMap",i.clearcoatNormalTexture)),i.clearcoatNormalTexture.scale!==void 0)){const s=i.clearcoatNormalTexture.scale;n.clearcoatNormalScale=new ae(s,s)}return Promise.all(r)}}class os{constructor(e){this.parser=e,this.name=E.KHR_MATERIALS_DISPERSION}getMaterialType(e){return C(this.parser,e,this.name)!==null?Y:null}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);return i===null||(n.dispersion=i.dispersion!==void 0?i.dispersion:0),Promise.resolve()}}class as{constructor(e){this.parser=e,this.name=E.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){return C(this.parser,e,this.name)!==null?Y:null}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);if(i===null)return Promise.resolve();const r=[];return i.iridescenceFactor!==void 0&&(n.iridescence=i.iridescenceFactor),i.iridescenceTexture!==void 0&&r.push(this.parser.assignTexture(n,"iridescenceMap",i.iridescenceTexture)),i.iridescenceIor!==void 0&&(n.iridescenceIOR=i.iridescenceIor),n.iridescenceThicknessRange===void 0&&(n.iridescenceThicknessRange=[100,400]),i.iridescenceThicknessMinimum!==void 0&&(n.iridescenceThicknessRange[0]=i.iridescenceThicknessMinimum),i.iridescenceThicknessMaximum!==void 0&&(n.iridescenceThicknessRange[1]=i.iridescenceThicknessMaximum),i.iridescenceThicknessTexture!==void 0&&r.push(this.parser.assignTexture(n,"iridescenceThicknessMap",i.iridescenceThicknessTexture)),Promise.all(r)}}class ls{constructor(e){this.parser=e,this.name=E.KHR_MATERIALS_SHEEN}getMaterialType(e){return C(this.parser,e,this.name)!==null?Y:null}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);if(i===null)return Promise.resolve();const r=[];if(n.sheenColor=new O(0,0,0),n.sheenRoughness=0,n.sheen=1,i.sheenColorFactor!==void 0){const s=i.sheenColorFactor;n.sheenColor.setRGB(s[0],s[1],s[2],Z)}return i.sheenRoughnessFactor!==void 0&&(n.sheenRoughness=i.sheenRoughnessFactor),i.sheenColorTexture!==void 0&&r.push(this.parser.assignTexture(n,"sheenColorMap",i.sheenColorTexture,Oe)),i.sheenRoughnessTexture!==void 0&&r.push(this.parser.assignTexture(n,"sheenRoughnessMap",i.sheenRoughnessTexture)),Promise.all(r)}}class us{constructor(e){this.parser=e,this.name=E.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){return C(this.parser,e,this.name)!==null?Y:null}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);if(i===null)return Promise.resolve();const r=[];return i.transmissionFactor!==void 0&&(n.transmission=i.transmissionFactor),i.transmissionTexture!==void 0&&r.push(this.parser.assignTexture(n,"transmissionMap",i.transmissionTexture)),Promise.all(r)}}class cs{constructor(e){this.parser=e,this.name=E.KHR_MATERIALS_VOLUME}getMaterialType(e){return C(this.parser,e,this.name)!==null?Y:null}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);if(i===null)return Promise.resolve();const r=[];n.thickness=i.thicknessFactor!==void 0?i.thicknessFactor:0,i.thicknessTexture!==void 0&&r.push(this.parser.assignTexture(n,"thicknessMap",i.thicknessTexture)),n.attenuationDistance=i.attenuationDistance||1/0;const s=i.attenuationColor||[1,1,1];return n.attenuationColor=new O().setRGB(s[0],s[1],s[2],Z),Promise.all(r)}}class ds{constructor(e){this.parser=e,this.name=E.KHR_MATERIALS_IOR}getMaterialType(e){return C(this.parser,e,this.name)!==null?Y:null}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);return i===null||(n.ior=i.ior!==void 0?i.ior:1.5),Promise.resolve()}}class hs{constructor(e){this.parser=e,this.name=E.KHR_MATERIALS_SPECULAR}getMaterialType(e){return C(this.parser,e,this.name)!==null?Y:null}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);if(i===null)return Promise.resolve();const r=[];n.specularIntensity=i.specularFactor!==void 0?i.specularFactor:1,i.specularTexture!==void 0&&r.push(this.parser.assignTexture(n,"specularIntensityMap",i.specularTexture));const s=i.specularColorFactor||[1,1,1];return n.specularColor=new O().setRGB(s[0],s[1],s[2],Z),i.specularColorTexture!==void 0&&r.push(this.parser.assignTexture(n,"specularColorMap",i.specularColorTexture,Oe)),Promise.all(r)}}class fs{constructor(e){this.parser=e,this.name=E.EXT_MATERIALS_BUMP}getMaterialType(e){return C(this.parser,e,this.name)!==null?Y:null}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);if(i===null)return Promise.resolve();const r=[];return n.bumpScale=i.bumpFactor!==void 0?i.bumpFactor:1,i.bumpTexture!==void 0&&r.push(this.parser.assignTexture(n,"bumpMap",i.bumpTexture)),Promise.all(r)}}class ps{constructor(e){this.parser=e,this.name=E.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){return C(this.parser,e,this.name)!==null?Y:null}extendMaterialParams(e,n){const i=C(this.parser,e,this.name);if(i===null)return Promise.resolve();const r=[];return i.anisotropyStrength!==void 0&&(n.anisotropy=i.anisotropyStrength),i.anisotropyRotation!==void 0&&(n.anisotropyRotation=i.anisotropyRotation),i.anisotropyTexture!==void 0&&r.push(this.parser.assignTexture(n,"anisotropyMap",i.anisotropyTexture)),Promise.all(r)}}class ms{constructor(e){this.parser=e,this.name=E.KHR_TEXTURE_BASISU}loadTexture(e){const n=this.parser,i=n.json,r=i.textures[e];if(!r.extensions||!r.extensions[this.name])return null;const s=r.extensions[this.name],o=n.options.ktx2Loader;if(!o){if(i.extensionsRequired&&i.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return n.loadTextureImage(e,s.source,o)}}class gs{constructor(e){this.parser=e,this.name=E.EXT_TEXTURE_WEBP}loadTexture(e){const n=this.name,i=this.parser,r=i.json,s=r.textures[e];if(!s.extensions||!s.extensions[n])return null;const o=s.extensions[n],l=r.images[o.source];let a=i.textureLoader;if(l.uri){const u=i.options.manager.getHandler(l.uri);u!==null&&(a=u)}return i.loadTextureImage(e,o.source,a)}}class _s{constructor(e){this.parser=e,this.name=E.EXT_TEXTURE_AVIF}loadTexture(e){const n=this.name,i=this.parser,r=i.json,s=r.textures[e];if(!s.extensions||!s.extensions[n])return null;const o=s.extensions[n],l=r.images[o.source];let a=i.textureLoader;if(l.uri){const u=i.options.manager.getHandler(l.uri);u!==null&&(a=u)}return i.loadTextureImage(e,o.source,a)}}class Tn{constructor(e,n){this.name=n,this.parser=e}loadBufferView(e){const n=this.parser.json,i=n.bufferViews[e];if(i.extensions&&i.extensions[this.name]){const r=i.extensions[this.name],s=this.parser.getDependency("buffer",r.buffer),o=this.parser.options.meshoptDecoder;if(!o||!o.supported){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return s.then(function(l){const a=r.byteOffset||0,u=r.byteLength||0,c=r.count,d=r.byteStride,h=new Uint8Array(l,a,u);return o.decodeGltfBufferAsync?o.decodeGltfBufferAsync(c,d,h,r.mode,r.filter).then(function(f){return f.buffer}):o.ready.then(function(){const f=new ArrayBuffer(c*d);return o.decodeGltfBuffer(new Uint8Array(f),c,d,h,r.mode,r.filter),f})})}else return null}}class vs{constructor(e){this.name=E.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){const n=this.parser.json,i=n.nodes[e];if(!i.extensions||!i.extensions[this.name]||i.mesh===void 0)return null;const r=n.meshes[i.mesh];for(const u of r.primitives)if(u.mode!==H.TRIANGLES&&u.mode!==H.TRIANGLE_STRIP&&u.mode!==H.TRIANGLE_FAN&&u.mode!==void 0)return null;const o=i.extensions[this.name].attributes,l=[],a={};for(const u in o)l.push(this.parser.getDependency("accessor",o[u]).then(c=>(a[u]=c,a[u])));return l.length<1?null:(l.push(this.parser.createNodeMesh(e)),Promise.all(l).then(u=>{const c=u.pop(),d=c.isGroup?c.children:[c],h=u[0].count,f=[];for(const p of d){const m=new F,g=new v,_=new A,y=new v(1,1,1),T=new yr(p.geometry,p.material,h);for(let M=0;M<h;M++)a.TRANSLATION&&g.fromBufferAttribute(a.TRANSLATION,M),a.ROTATION&&_.fromBufferAttribute(a.ROTATION,M),a.SCALE&&y.fromBufferAttribute(a.SCALE,M),T.setMatrixAt(M,m.compose(g,_,y));for(const M in a)if(M==="_COLOR_0"){const x=a[M];T.instanceColor=new Rr(x.array,x.itemSize,x.normalized)}else M!=="TRANSLATION"&&M!=="ROTATION"&&M!=="SCALE"&&p.geometry.setAttribute(M,a[M]);ve.prototype.copy.call(T,p),this.parser.assignFinalMaterial(T),f.push(T)}return c.isGroup?(c.clear(),c.add(...f),c):f[0]}))}}const mi="glTF",we=12,xn={JSON:1313821514,BIN:5130562};class Ms{constructor(e){this.name=E.KHR_BINARY_GLTF,this.content=null,this.body=null;const n=new DataView(e,0,we),i=new TextDecoder;if(this.header={magic:i.decode(new Uint8Array(e.slice(0,4))),version:n.getUint32(4,!0),length:n.getUint32(8,!0)},this.header.magic!==mi)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");const r=this.header.length-we,s=new DataView(e,we);let o=0;for(;o<r;){const l=s.getUint32(o,!0);o+=4;const a=s.getUint32(o,!0);if(o+=4,a===xn.JSON){const u=new Uint8Array(e,we+o,l);this.content=i.decode(u)}else if(a===xn.BIN){const u=we+o;this.body=e.slice(u,u+l)}o+=l}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}}class Ts{constructor(e,n){if(!n)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=E.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=n,this.dracoLoader.preload()}decodePrimitive(e,n){const i=this.json,r=this.dracoLoader,s=e.extensions[this.name].bufferView,o=e.extensions[this.name].attributes,l={},a={},u={};for(const c in o){const d=Tt[c]||c.toLowerCase();l[d]=o[c]}for(const c in e.attributes){const d=Tt[c]||c.toLowerCase();if(o[c]!==void 0){const h=i.accessors[e.attributes[c]],f=_e[h.componentType];u[d]=f.name,a[d]=h.normalized===!0}}return n.getDependency("bufferView",s).then(function(c){return new Promise(function(d,h){r.decodeDracoFile(c,function(f){for(const p in f.attributes){const m=f.attributes[p],g=a[p];g!==void 0&&(m.normalized=g)}d(f)},l,u,Z,h)})})}}class xs{constructor(){this.name=E.KHR_TEXTURE_TRANSFORM}extendTexture(e,n){return(n.texCoord===void 0||n.texCoord===e.channel)&&n.offset===void 0&&n.rotation===void 0&&n.scale===void 0||(e=e.clone(),n.texCoord!==void 0&&(e.channel=n.texCoord),n.offset!==void 0&&e.offset.fromArray(n.offset),n.rotation!==void 0&&(e.rotation=n.rotation),n.scale!==void 0&&e.repeat.fromArray(n.scale),e.needsUpdate=!0),e}}class ys{constructor(){this.name=E.KHR_MESH_QUANTIZATION}}class gi extends kr{constructor(e,n,i,r){super(e,n,i,r)}copySampleValue_(e){const n=this.resultBuffer,i=this.sampleValues,r=this.valueSize,s=e*r*3+r;for(let o=0;o!==r;o++)n[o]=i[s+o];return n}interpolate_(e,n,i,r){const s=this.resultBuffer,o=this.sampleValues,l=this.valueSize,a=l*2,u=l*3,c=r-n,d=(i-n)/c,h=d*d,f=h*d,p=e*u,m=p-u,g=-2*f+3*h,_=f-h,y=1-g,T=_-h+d;for(let M=0;M!==l;M++){const x=o[m+M+l],R=o[m+M+a]*c,w=o[p+M+l],S=o[p+M]*c;s[M]=y*x+T*R+g*w+_*S}return s}}const Rs=new A;class ws extends gi{interpolate_(e,n,i,r){const s=super.interpolate_(e,n,i,r);return Rs.fromArray(s).normalize().toArray(s),s}}const H={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6},_e={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},yn={9728:ci,9729:_t,9984:Lr,9985:Ar,9986:Sr,9987:ui},Rn={33071:br,33648:Pr,10497:vt},tt={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},Tt={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},J={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},Es={CUBICSPLINE:void 0,LINEAR:fi,STEP:Br},nt={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function Ss(t){return t.DefaultMaterial===void 0&&(t.DefaultMaterial=new je({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:Hr})),t.DefaultMaterial}function ie(t,e,n){for(const i in n.extensions)t[i]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[i]=n.extensions[i])}function X(t,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(t.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function As(t,e,n){let i=!1,r=!1,s=!1;for(let u=0,c=e.length;u<c;u++){const d=e[u];if(d.POSITION!==void 0&&(i=!0),d.NORMAL!==void 0&&(r=!0),d.COLOR_0!==void 0&&(s=!0),i&&r&&s)break}if(!i&&!r&&!s)return Promise.resolve(t);const o=[],l=[],a=[];for(let u=0,c=e.length;u<c;u++){const d=e[u];if(i){const h=d.POSITION!==void 0?n.getDependency("accessor",d.POSITION):t.attributes.position;o.push(h)}if(r){const h=d.NORMAL!==void 0?n.getDependency("accessor",d.NORMAL):t.attributes.normal;l.push(h)}if(s){const h=d.COLOR_0!==void 0?n.getDependency("accessor",d.COLOR_0):t.attributes.color;a.push(h)}}return Promise.all([Promise.all(o),Promise.all(l),Promise.all(a)]).then(function(u){const c=u[0],d=u[1],h=u[2];return i&&(t.morphAttributes.position=c),r&&(t.morphAttributes.normal=d),s&&(t.morphAttributes.color=h),t.morphTargetsRelative=!0,t})}function Ls(t,e){if(t.updateMorphTargets(),e.weights!==void 0)for(let n=0,i=e.weights.length;n<i;n++)t.morphTargetInfluences[n]=e.weights[n];if(e.extras&&Array.isArray(e.extras.targetNames)){const n=e.extras.targetNames;if(t.morphTargetInfluences.length===n.length){t.morphTargetDictionary={};for(let i=0,r=n.length;i<r;i++)t.morphTargetDictionary[n[i]]=i}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function Ps(t){let e;const n=t.extensions&&t.extensions[E.KHR_DRACO_MESH_COMPRESSION];if(n?e="draco:"+n.bufferView+":"+n.indices+":"+it(n.attributes):e=t.indices+":"+it(t.attributes)+":"+t.mode,t.targets!==void 0)for(let i=0,r=t.targets.length;i<r;i++)e+=":"+it(t.targets[i]);return e}function it(t){let e="";const n=Object.keys(t).sort();for(let i=0,r=n.length;i<r;i++)e+=n[i]+":"+t[n[i]]+";";return e}function xt(t){switch(t){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function bs(t){return t.search(/\.jpe?g($|\?)/i)>0||t.search(/^data\:image\/jpeg/)===0?"image/jpeg":t.search(/\.webp($|\?)/i)>0||t.search(/^data\:image\/webp/)===0?"image/webp":t.search(/\.ktx2($|\?)/i)>0||t.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}const Is=new F;class Os{constructor(e={},n={}){this.json=e,this.extensions={},this.plugins={},this.options=n,this.cache=new ts,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let i=!1,r=-1,s=!1,o=-1;if(typeof navigator<"u"&&typeof navigator.userAgent<"u"){const l=navigator.userAgent;i=/^((?!chrome|android).)*safari/i.test(l)===!0;const a=l.match(/Version\/(\d+)/);r=i&&a?parseInt(a[1],10):-1,s=l.indexOf("Firefox")>-1,o=s?l.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||i&&r<17||s&&o<98?this.textureLoader=new wr(this.options.manager):this.textureLoader=new Er(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new li(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,n){const i=this,r=this.json,s=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(o){return o._markDefs&&o._markDefs()}),Promise.all(this._invokeAll(function(o){return o.beforeRoot&&o.beforeRoot()})).then(function(){return Promise.all([i.getDependencies("scene"),i.getDependencies("animation"),i.getDependencies("camera")])}).then(function(o){const l={scene:o[0][r.scene||0],scenes:o[0],animations:o[1],cameras:o[2],asset:r.asset,parser:i,userData:{}};return ie(s,l,r),X(l,r),Promise.all(i._invokeAll(function(a){return a.afterRoot&&a.afterRoot(l)})).then(function(){for(const a of l.scenes)a.updateMatrixWorld();e(l)})}).catch(n)}_markDefs(){const e=this.json.nodes||[],n=this.json.skins||[],i=this.json.meshes||[];for(let r=0,s=n.length;r<s;r++){const o=n[r].joints;for(let l=0,a=o.length;l<a;l++)e[o[l]].isBone=!0}for(let r=0,s=e.length;r<s;r++){const o=e[r];o.mesh!==void 0&&(this._addNodeRef(this.meshCache,o.mesh),o.skin!==void 0&&(i[o.mesh].isSkinnedMesh=!0)),o.camera!==void 0&&this._addNodeRef(this.cameraCache,o.camera)}}_addNodeRef(e,n){n!==void 0&&(e.refs[n]===void 0&&(e.refs[n]=e.uses[n]=0),e.refs[n]++)}_getNodeRef(e,n,i){if(e.refs[n]<=1)return i;const r=i.clone(),s=(o,l)=>{const a=this.associations.get(o);a!=null&&this.associations.set(l,a);for(const[u,c]of o.children.entries())s(c,l.children[u])};return s(i,r),r.name+="_instance_"+e.uses[n]++,r}_invokeOne(e){const n=Object.values(this.plugins);n.push(this);for(let i=0;i<n.length;i++){const r=e(n[i]);if(r)return r}return null}_invokeAll(e){const n=Object.values(this.plugins);n.unshift(this);const i=[];for(let r=0;r<n.length;r++){const s=e(n[r]);s&&i.push(s)}return i}getDependency(e,n){const i=e+":"+n;let r=this.cache.get(i);if(!r){switch(e){case"scene":r=this.loadScene(n);break;case"node":r=this._invokeOne(function(s){return s.loadNode&&s.loadNode(n)});break;case"mesh":r=this._invokeOne(function(s){return s.loadMesh&&s.loadMesh(n)});break;case"accessor":r=this.loadAccessor(n);break;case"bufferView":r=this._invokeOne(function(s){return s.loadBufferView&&s.loadBufferView(n)});break;case"buffer":r=this.loadBuffer(n);break;case"material":r=this._invokeOne(function(s){return s.loadMaterial&&s.loadMaterial(n)});break;case"texture":r=this._invokeOne(function(s){return s.loadTexture&&s.loadTexture(n)});break;case"skin":r=this.loadSkin(n);break;case"animation":r=this._invokeOne(function(s){return s.loadAnimation&&s.loadAnimation(n)});break;case"camera":r=this.loadCamera(n);break;default:if(r=this._invokeOne(function(s){return s!=this&&s.getDependency&&s.getDependency(e,n)}),!r)throw new Error("Unknown type: "+e);break}this.cache.add(i,r)}return r}getDependencies(e){let n=this.cache.get(e);if(!n){const i=this,r=this.json[e+(e==="mesh"?"es":"s")]||[];n=Promise.all(r.map(function(s,o){return i.getDependency(e,o)})),this.cache.add(e,n)}return n}loadBuffer(e){const n=this.json.buffers[e],i=this.fileLoader;if(n.type&&n.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+n.type+" buffer type is not supported.");if(n.uri===void 0&&e===0)return Promise.resolve(this.extensions[E.KHR_BINARY_GLTF].body);const r=this.options;return new Promise(function(s,o){i.load(Ie.resolveURL(n.uri,r.path),s,void 0,function(){o(new Error('THREE.GLTFLoader: Failed to load buffer "'+n.uri+'".'))})})}loadBufferView(e){const n=this.json.bufferViews[e];return this.getDependency("buffer",n.buffer).then(function(i){const r=n.byteLength||0,s=n.byteOffset||0;return i.slice(s,s+r)})}loadAccessor(e){const n=this,i=this.json,r=this.json.accessors[e];if(r.bufferView===void 0&&r.sparse===void 0){const o=tt[r.type],l=_e[r.componentType],a=r.normalized===!0,u=new l(r.count*o);return Promise.resolve(new U(u,o,a))}const s=[];return r.bufferView!==void 0?s.push(this.getDependency("bufferView",r.bufferView)):s.push(null),r.sparse!==void 0&&(s.push(this.getDependency("bufferView",r.sparse.indices.bufferView)),s.push(this.getDependency("bufferView",r.sparse.values.bufferView))),Promise.all(s).then(function(o){const l=o[0],a=tt[r.type],u=_e[r.componentType],c=u.BYTES_PER_ELEMENT,d=c*a,h=r.byteOffset||0,f=r.bufferView!==void 0?i.bufferViews[r.bufferView].byteStride:void 0,p=r.normalized===!0;let m,g;if(f&&f!==d){const _=Math.floor(h/f),y="InterleavedBuffer:"+r.bufferView+":"+r.componentType+":"+_+":"+r.count;let T=n.cache.get(y);T||(m=new u(l,_*f,r.count*f/c),T=new Lt(m,f/c),n.cache.add(y,T)),g=new Pt(T,a,h%f/c,p)}else l===null?m=new u(r.count*a):m=new u(l,h,r.count*a),g=new U(m,a,p);if(r.sparse!==void 0){const _=tt.SCALAR,y=_e[r.sparse.indices.componentType],T=r.sparse.indices.byteOffset||0,M=r.sparse.values.byteOffset||0,x=new y(o[1],T,r.sparse.count*_),R=new u(o[2],M,r.sparse.count*a);l!==null&&(g=new U(g.array.slice(),g.itemSize,g.normalized)),g.normalized=!1;for(let w=0,S=x.length;w<S;w++){const I=x[w];if(g.setX(I,R[w*a]),a>=2&&g.setY(I,R[w*a+1]),a>=3&&g.setZ(I,R[w*a+2]),a>=4&&g.setW(I,R[w*a+3]),a>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}g.normalized=p}return g})}loadTexture(e){const n=this.json,i=this.options,s=n.textures[e].source,o=n.images[s];let l=this.textureLoader;if(o.uri){const a=i.manager.getHandler(o.uri);a!==null&&(l=a)}return this.loadTextureImage(e,s,l)}loadTextureImage(e,n,i){const r=this,s=this.json,o=s.textures[e],l=s.images[n],a=(l.uri||l.bufferView)+":"+o.sampler;if(this.textureCache[a])return this.textureCache[a];const u=this.loadImageSource(n,i).then(function(c){c.flipY=!1,c.name=o.name||l.name||"",c.name===""&&typeof l.uri=="string"&&l.uri.startsWith("data:image/")===!1&&(c.name=l.uri);const h=(s.samplers||{})[o.sampler]||{};return c.magFilter=yn[h.magFilter]||_t,c.minFilter=yn[h.minFilter]||ui,c.wrapS=Rn[h.wrapS]||vt,c.wrapT=Rn[h.wrapT]||vt,c.generateMipmaps=!c.isCompressedTexture&&c.minFilter!==ci&&c.minFilter!==_t,r.associations.set(c,{textures:e}),c}).catch(function(){return null});return this.textureCache[a]=u,u}loadImageSource(e,n){const i=this,r=this.json,s=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(d=>d.clone());const o=r.images[e],l=self.URL||self.webkitURL;let a=o.uri||"",u=!1;if(o.bufferView!==void 0)a=i.getDependency("bufferView",o.bufferView).then(function(d){u=!0;const h=new Blob([d],{type:o.mimeType});return a=l.createObjectURL(h),a});else if(o.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");const c=Promise.resolve(a).then(function(d){return new Promise(function(h,f){let p=h;n.isImageBitmapLoader===!0&&(p=function(m){const g=new hn(m);g.needsUpdate=!0,h(g)}),n.load(Ie.resolveURL(d,s.path),p,void 0,f)})}).then(function(d){return u===!0&&l.revokeObjectURL(a),X(d,o),d.userData.mimeType=o.mimeType||bs(o.uri),d}).catch(function(d){throw console.error("THREE.GLTFLoader: Couldn't load texture",a),d});return this.sourceCache[e]=c,c}assignTexture(e,n,i,r){const s=this;return this.getDependency("texture",i.index).then(function(o){if(!o)return null;if(i.texCoord!==void 0&&i.texCoord>0&&(o=o.clone(),o.channel=i.texCoord),s.extensions[E.KHR_TEXTURE_TRANSFORM]){const l=i.extensions!==void 0?i.extensions[E.KHR_TEXTURE_TRANSFORM]:void 0;if(l){const a=s.associations.get(o);o=s.extensions[E.KHR_TEXTURE_TRANSFORM].extendTexture(o,l),s.associations.set(o,a)}}return r!==void 0&&(o.colorSpace=r),e[n]=o,o})}assignFinalMaterial(e){const n=e.geometry;let i=e.material;const r=n.attributes.tangent===void 0,s=n.attributes.color!==void 0,o=n.attributes.normal===void 0;if(e.isPoints){const l="PointsMaterial:"+i.uuid;let a=this.cache.get(l);a||(a=new Ir,ke.prototype.copy.call(a,i),a.color.copy(i.color),a.map=i.map,a.sizeAttenuation=!1,this.cache.add(l,a)),i=a}else if(e.isLine){const l="LineBasicMaterial:"+i.uuid;let a=this.cache.get(l);a||(a=new Ne,ke.prototype.copy.call(a,i),a.color.copy(i.color),a.map=i.map,this.cache.add(l,a)),i=a}if(r||s||o){let l="ClonedMaterial:"+i.uuid+":";r&&(l+="derivative-tangents:"),s&&(l+="vertex-colors:"),o&&(l+="flat-shading:");let a=this.cache.get(l);a||(a=i.clone(),s&&(a.vertexColors=!0),o&&(a.flatShading=!0),r&&(a.normalScale&&(a.normalScale.y*=-1),a.clearcoatNormalScale&&(a.clearcoatNormalScale.y*=-1)),this.cache.add(l,a),this.associations.set(a,this.associations.get(i))),i=a}e.material=i}getMaterialType(){return je}loadMaterial(e){const n=this,i=this.json,r=this.extensions,s=i.materials[e];let o;const l={},a=s.extensions||{},u=[];if(a[E.KHR_MATERIALS_UNLIT]){const d=r[E.KHR_MATERIALS_UNLIT];o=d.getMaterialType(),u.push(d.extendParams(l,s,n))}else{const d=s.pbrMetallicRoughness||{};if(l.color=new O(1,1,1),l.opacity=1,Array.isArray(d.baseColorFactor)){const h=d.baseColorFactor;l.color.setRGB(h[0],h[1],h[2],Z),l.opacity=h[3]}d.baseColorTexture!==void 0&&u.push(n.assignTexture(l,"map",d.baseColorTexture,Oe)),l.metalness=d.metallicFactor!==void 0?d.metallicFactor:1,l.roughness=d.roughnessFactor!==void 0?d.roughnessFactor:1,d.metallicRoughnessTexture!==void 0&&(u.push(n.assignTexture(l,"metalnessMap",d.metallicRoughnessTexture)),u.push(n.assignTexture(l,"roughnessMap",d.metallicRoughnessTexture))),o=this._invokeOne(function(h){return h.getMaterialType&&h.getMaterialType(e)}),u.push(Promise.all(this._invokeAll(function(h){return h.extendMaterialParams&&h.extendMaterialParams(e,l)})))}s.doubleSided===!0&&(l.side=Mt);const c=s.alphaMode||nt.OPAQUE;if(c===nt.BLEND?(l.transparent=!0,l.depthWrite=!1):(l.transparent=!1,c===nt.MASK&&(l.alphaTest=s.alphaCutoff!==void 0?s.alphaCutoff:.5)),s.normalTexture!==void 0&&o!==le&&(u.push(n.assignTexture(l,"normalMap",s.normalTexture)),l.normalScale=new ae(1,1),s.normalTexture.scale!==void 0)){const d=s.normalTexture.scale;l.normalScale.set(d,d)}if(s.occlusionTexture!==void 0&&o!==le&&(u.push(n.assignTexture(l,"aoMap",s.occlusionTexture)),s.occlusionTexture.strength!==void 0&&(l.aoMapIntensity=s.occlusionTexture.strength)),s.emissiveFactor!==void 0&&o!==le){const d=s.emissiveFactor;l.emissive=new O().setRGB(d[0],d[1],d[2],Z)}return s.emissiveTexture!==void 0&&o!==le&&u.push(n.assignTexture(l,"emissiveMap",s.emissiveTexture,Oe)),Promise.all(u).then(function(){const d=new o(l);return s.name&&(d.name=s.name),X(d,s),n.associations.set(d,{materials:e}),s.extensions&&ie(r,d,s),d})}createUniqueName(e){const n=Or.sanitizeNodeName(e||"");return n in this.nodeNamesUsed?n+"_"+ ++this.nodeNamesUsed[n]:(this.nodeNamesUsed[n]=0,n)}loadGeometries(e){const n=this,i=this.extensions,r=this.primitiveCache;function s(l){return i[E.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(l,n).then(function(a){return wn(a,l,n)})}const o=[];for(let l=0,a=e.length;l<a;l++){const u=e[l],c=Ps(u),d=r[c];if(d)o.push(d.promise);else{let h;u.extensions&&u.extensions[E.KHR_DRACO_MESH_COMPRESSION]?h=s(u):h=wn(new K,u,n),r[c]={primitive:u,promise:h},o.push(h)}}return Promise.all(o)}loadMesh(e){const n=this,i=this.json,r=this.extensions,s=i.meshes[e],o=s.primitives,l=[];for(let a=0,u=o.length;a<u;a++){const c=o[a].material===void 0?Ss(this.cache):this.getDependency("material",o[a].material);l.push(c)}return l.push(n.loadGeometries(o)),Promise.all(l).then(function(a){const u=a.slice(0,a.length-1),c=a[a.length-1],d=[];for(let f=0,p=c.length;f<p;f++){const m=c[f],g=o[f];let _;const y=u[f];if(g.mode===H.TRIANGLES||g.mode===H.TRIANGLE_STRIP||g.mode===H.TRIANGLE_FAN||g.mode===void 0)_=s.isSkinnedMesh===!0?new di(m,y):new ue(m,y),_.isSkinnedMesh===!0&&_.normalizeSkinWeights(),g.mode===H.TRIANGLE_STRIP?_.geometry=Mn(_.geometry,ai):g.mode===H.TRIANGLE_FAN&&(_.geometry=Mn(_.geometry,gt));else if(g.mode===H.LINES)_=new Ze(m,y);else if(g.mode===H.LINE_STRIP)_=new hi(m,y);else if(g.mode===H.LINE_LOOP)_=new Nr(m,y);else if(g.mode===H.POINTS)_=new Cr(m,y);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+g.mode);Object.keys(_.geometry.morphAttributes).length>0&&Ls(_,s),_.name=n.createUniqueName(s.name||"mesh_"+e),X(_,s),g.extensions&&ie(r,_,g),n.assignFinalMaterial(_),d.push(_)}for(let f=0,p=d.length;f<p;f++)n.associations.set(d[f],{meshes:e,primitives:f});if(d.length===1)return s.extensions&&ie(r,d[0],s),d[0];const h=new q;s.extensions&&ie(r,h,s),n.associations.set(h,{meshes:e});for(let f=0,p=d.length;f<p;f++)h.add(d[f]);return h})}loadCamera(e){let n;const i=this.json.cameras[e],r=i[i.type];if(!r){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return i.type==="perspective"?n=new Ur(N.radToDeg(r.yfov),r.aspectRatio||1,r.znear||1,r.zfar||2e6):i.type==="orthographic"&&(n=new Vr(-r.xmag,r.xmag,r.ymag,-r.ymag,r.znear,r.zfar)),i.name&&(n.name=this.createUniqueName(i.name)),X(n,i),Promise.resolve(n)}loadSkin(e){const n=this.json.skins[e],i=[];for(let r=0,s=n.joints.length;r<s;r++)i.push(this._loadNodeShallow(n.joints[r]));return n.inverseBindMatrices!==void 0?i.push(this.getDependency("accessor",n.inverseBindMatrices)):i.push(null),Promise.all(i).then(function(r){const s=r.pop(),o=r,l=[],a=[];for(let u=0,c=o.length;u<c;u++){const d=o[u];if(d){l.push(d);const h=new F;s!==null&&h.fromArray(s.array,u*16),a.push(h)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',n.joints[u])}return new $e(l,a)})}loadAnimation(e){const n=this.json,i=this,r=n.animations[e],s=r.name?r.name:"animation_"+e,o=[],l=[],a=[],u=[],c=[];for(let d=0,h=r.channels.length;d<h;d++){const f=r.channels[d],p=r.samplers[f.sampler],m=f.target,g=m.node,_=r.parameters!==void 0?r.parameters[p.input]:p.input,y=r.parameters!==void 0?r.parameters[p.output]:p.output;m.node!==void 0&&(o.push(this.getDependency("node",g)),l.push(this.getDependency("accessor",_)),a.push(this.getDependency("accessor",y)),u.push(p),c.push(m))}return Promise.all([Promise.all(o),Promise.all(l),Promise.all(a),Promise.all(u),Promise.all(c)]).then(function(d){const h=d[0],f=d[1],p=d[2],m=d[3],g=d[4],_=[];for(let T=0,M=h.length;T<M;T++){const x=h[T],R=f[T],w=p[T],S=m[T],I=g[T];if(x===void 0)continue;x.updateMatrix&&x.updateMatrix();const P=i._createAnimationTracks(x,R,w,S,I);if(P)for(let b=0;b<P.length;b++)_.push(P[b])}const y=new Dr(s,void 0,_);return X(y,r),y})}createNodeMesh(e){const n=this.json,i=this,r=n.nodes[e];return r.mesh===void 0?null:i.getDependency("mesh",r.mesh).then(function(s){const o=i._getNodeRef(i.meshCache,r.mesh,s);return r.weights!==void 0&&o.traverse(function(l){if(l.isMesh)for(let a=0,u=r.weights.length;a<u;a++)l.morphTargetInfluences[a]=r.weights[a]}),o})}loadNode(e){const n=this.json,i=this,r=n.nodes[e],s=i._loadNodeShallow(e),o=[],l=r.children||[];for(let u=0,c=l.length;u<c;u++)o.push(i.getDependency("node",l[u]));const a=r.skin===void 0?Promise.resolve(null):i.getDependency("skin",r.skin);return Promise.all([s,Promise.all(o),a]).then(function(u){const c=u[0],d=u[1],h=u[2];h!==null&&c.traverse(function(f){f.isSkinnedMesh&&f.bind(h,Is)});for(let f=0,p=d.length;f<p;f++)c.add(d[f]);if(c.userData.pivot!==void 0&&d.length>0){const f=c.userData.pivot,p=d[0];c.pivot=new v().fromArray(f),c.position.x-=f[0],c.position.y-=f[1],c.position.z-=f[2],p.position.set(0,0,0),delete c.userData.pivot}return c})}_loadNodeShallow(e){const n=this.json,i=this.extensions,r=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];const s=n.nodes[e],o=s.name?r.createUniqueName(s.name):"",l=[],a=r._invokeOne(function(u){return u.createNodeMesh&&u.createNodeMesh(e)});return a&&l.push(a),s.camera!==void 0&&l.push(r.getDependency("camera",s.camera).then(function(u){return r._getNodeRef(r.cameraCache,s.camera,u)})),r._invokeAll(function(u){return u.createNodeAttachment&&u.createNodeAttachment(e)}).forEach(function(u){l.push(u)}),this.nodeCache[e]=Promise.all(l).then(function(u){let c;if(s.isBone===!0?c=new Fr:u.length>1?c=new q:u.length===1?c=u[0]:c=new ve,c!==u[0])for(let d=0,h=u.length;d<h;d++)c.add(u[d]);if(s.name&&(c.userData.name=s.name,c.name=o),X(c,s),s.extensions&&ie(i,c,s),s.matrix!==void 0){const d=new F;d.fromArray(s.matrix),c.applyMatrix4(d)}else s.translation!==void 0&&c.position.fromArray(s.translation),s.rotation!==void 0&&c.quaternion.fromArray(s.rotation),s.scale!==void 0&&c.scale.fromArray(s.scale);if(!r.associations.has(c))r.associations.set(c,{});else if(s.mesh!==void 0&&r.meshCache.refs[s.mesh]>1){const d=r.associations.get(c);r.associations.set(c,{...d})}return r.associations.get(c).nodes=e,c}),this.nodeCache[e]}loadScene(e){const n=this.extensions,i=this.json.scenes[e],r=this,s=new q;i.name&&(s.name=r.createUniqueName(i.name)),X(s,i),i.extensions&&ie(n,s,i);const o=i.nodes||[],l=[];for(let a=0,u=o.length;a<u;a++)l.push(r.getDependency("node",o[a]));return Promise.all(l).then(function(a){for(let c=0,d=a.length;c<d;c++){const h=a[c];h.parent!==null?s.add(Jr(h)):s.add(h)}const u=c=>{const d=new Map;for(const[h,f]of r.associations)(h instanceof ke||h instanceof hn)&&d.set(h,f);return c.traverse(h=>{const f=r.associations.get(h);f!=null&&d.set(h,f)}),d};return r.associations=u(s),s})}_createAnimationTracks(e,n,i,r,s){const o=[],l=e.name?e.name:e.uuid,a=[];J[s.path]===J.weights?e.traverse(function(h){h.morphTargetInfluences&&a.push(h.name?h.name:h.uuid)}):a.push(l);let u;switch(J[s.path]){case J.weights:u=pn;break;case J.rotation:u=mn;break;case J.translation:case J.scale:u=fn;break;default:switch(i.itemSize){case 1:u=pn;break;case 2:case 3:default:u=fn;break}break}const c=r.interpolation!==void 0?Es[r.interpolation]:fi,d=this._getArrayFromAccessor(i);for(let h=0,f=a.length;h<f;h++){const p=new u(a[h]+"."+J[s.path],n.array,d,c);r.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(p),o.push(p)}return o}_getArrayFromAccessor(e){let n=e.array;if(e.normalized){const i=xt(n.constructor),r=new Float32Array(n.length);for(let s=0,o=n.length;s<o;s++)r[s]=n[s]*i;n=r}return n}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(i){const r=this instanceof mn?ws:gi;return new r(this.times,this.values,this.getValueSize()/3,i)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}function Ns(t,e,n){const i=e.attributes,r=new Wr;if(i.POSITION!==void 0){const l=n.json.accessors[i.POSITION],a=l.min,u=l.max;if(a!==void 0&&u!==void 0){if(r.set(new v(a[0],a[1],a[2]),new v(u[0],u[1],u[2])),l.normalized){const c=xt(_e[l.componentType]);r.min.multiplyScalar(c),r.max.multiplyScalar(c)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;const s=e.targets;if(s!==void 0){const l=new v,a=new v;for(let u=0,c=s.length;u<c;u++){const d=s[u];if(d.POSITION!==void 0){const h=n.json.accessors[d.POSITION],f=h.min,p=h.max;if(f!==void 0&&p!==void 0){if(a.setX(Math.max(Math.abs(f[0]),Math.abs(p[0]))),a.setY(Math.max(Math.abs(f[1]),Math.abs(p[1]))),a.setZ(Math.max(Math.abs(f[2]),Math.abs(p[2]))),h.normalized){const m=xt(_e[h.componentType]);a.multiplyScalar(m)}l.max(a)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}r.expandByVector(l)}t.boundingBox=r;const o=new Gr;r.getCenter(o.center),o.radius=r.min.distanceTo(r.max)/2,t.boundingSphere=o}function wn(t,e,n){const i=e.attributes,r=[];function s(o,l){return n.getDependency("accessor",o).then(function(a){t.setAttribute(l,a)})}for(const o in i){const l=Tt[o]||o.toLowerCase();l in t.attributes||r.push(s(i[o],l))}if(e.indices!==void 0&&!t.index){const o=n.getDependency("accessor",e.indices).then(function(l){t.setIndex(l)});r.push(o)}return gn.workingColorSpace!==Z&&"COLOR_0"in i&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${gn.workingColorSpace}" not supported.`),X(t,e),Ns(t,e,n),Promise.all(r).then(function(){return e.targets!==void 0?As(t,e.targets,n):t})}/*!
 * @pixiv/three-vrm v3.5.1
 * VRM file loader for three.js.
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 */var De=(t,e,n)=>new Promise((i,r)=>{var s=a=>{try{l(n.next(a))}catch(u){r(u)}},o=a=>{try{l(n.throw(a))}catch(u){r(u)}},l=a=>a.done?i(a.value):Promise.resolve(a.value).then(s,o);l((n=n.apply(t,e)).next())}),L=(t,e,n)=>new Promise((i,r)=>{var s=a=>{try{l(n.next(a))}catch(u){r(u)}},o=a=>{try{l(n.throw(a))}catch(u){r(u)}},l=a=>a.done?i(a.value):Promise.resolve(a.value).then(s,o);l((n=n.apply(t,e)).next())}),En=class extends ve{constructor(t){super(),this.weight=0,this.isBinary=!1,this.overrideBlink="none",this.overrideLookAt="none",this.overrideMouth="none",this._binds=[],this.name=`VRMExpression_${t}`,this.expressionName=t,this.type="VRMExpression",this.visible=!1}get binds(){return this._binds}get overrideBlinkAmount(){return this.overrideBlink==="block"?0<this.outputWeight?1:0:this.overrideBlink==="blend"?this.outputWeight:0}get overrideLookAtAmount(){return this.overrideLookAt==="block"?0<this.outputWeight?1:0:this.overrideLookAt==="blend"?this.outputWeight:0}get overrideMouthAmount(){return this.overrideMouth==="block"?0<this.outputWeight?1:0:this.overrideMouth==="blend"?this.outputWeight:0}get outputWeight(){return this.isBinary?this.weight>.5?1:0:this.weight}addBind(t){this._binds.push(t)}deleteBind(t){const e=this._binds.indexOf(t);e>=0&&this._binds.splice(e,1)}applyWeight(t){var e;let n=this.outputWeight;n*=(e=t==null?void 0:t.multiplier)!=null?e:1,this.isBinary&&n<1&&(n=0),this._binds.forEach(i=>i.applyWeight(n))}clearAppliedWeight(){this._binds.forEach(t=>t.clearAppliedWeight())}};function _i(t,e,n){var i,r;const s=t.parser.json,o=(i=s.nodes)==null?void 0:i[e];if(o==null)return console.warn(`extractPrimitivesInternal: Attempt to use nodes[${e}] of glTF but the node doesn't exist`),null;const l=o.mesh;if(l==null)return null;const a=(r=s.meshes)==null?void 0:r[l];if(a==null)return console.warn(`extractPrimitivesInternal: Attempt to use meshes[${l}] of glTF but the mesh doesn't exist`),null;const u=a.primitives.length,c=[];return n.traverse(d=>{c.length<u&&d.isMesh&&c.push(d)}),c}function Sn(t,e){return L(this,null,function*(){const n=yield t.parser.getDependency("node",e);return _i(t,e,n)})}function An(t){return L(this,null,function*(){const e=yield t.parser.getDependencies("node"),n=new Map;return e.forEach((i,r)=>{const s=_i(t,r,i);s!=null&&n.set(r,s)}),n})}var yt={Aa:"aa",Ih:"ih",Ou:"ou",Ee:"ee",Oh:"oh",Blink:"blink",Happy:"happy",Angry:"angry",Sad:"sad",Relaxed:"relaxed",LookUp:"lookUp",Surprised:"surprised",LookDown:"lookDown",LookLeft:"lookLeft",LookRight:"lookRight",BlinkLeft:"blinkLeft",BlinkRight:"blinkRight",Neutral:"neutral"};function vi(t){return Math.max(Math.min(t,1),0)}var Ln=class Mi{constructor(){this.blinkExpressionNames=["blink","blinkLeft","blinkRight"],this.lookAtExpressionNames=["lookLeft","lookRight","lookUp","lookDown"],this.mouthExpressionNames=["aa","ee","ih","oh","ou"],this._expressions=[],this._expressionMap={}}get expressions(){return this._expressions.concat()}get expressionMap(){return Object.assign({},this._expressionMap)}get presetExpressionMap(){const e={},n=new Set(Object.values(yt));return Object.entries(this._expressionMap).forEach(([i,r])=>{n.has(i)&&(e[i]=r)}),e}get customExpressionMap(){const e={},n=new Set(Object.values(yt));return Object.entries(this._expressionMap).forEach(([i,r])=>{n.has(i)||(e[i]=r)}),e}copy(e){return this._expressions.concat().forEach(i=>{this.unregisterExpression(i)}),e._expressions.forEach(i=>{this.registerExpression(i)}),this.blinkExpressionNames=e.blinkExpressionNames.concat(),this.lookAtExpressionNames=e.lookAtExpressionNames.concat(),this.mouthExpressionNames=e.mouthExpressionNames.concat(),this}clone(){return new Mi().copy(this)}getExpression(e){var n;return(n=this._expressionMap[e])!=null?n:null}registerExpression(e){this._expressions.push(e),this._expressionMap[e.expressionName]=e}unregisterExpression(e){const n=this._expressions.indexOf(e);n===-1&&console.warn("VRMExpressionManager: The specified expressions is not registered"),this._expressions.splice(n,1),delete this._expressionMap[e.expressionName]}getValue(e){var n;const i=this.getExpression(e);return(n=i==null?void 0:i.weight)!=null?n:null}setValue(e,n){const i=this.getExpression(e);i&&(i.weight=vi(n))}resetValues(){this._expressions.forEach(e=>{e.weight=0})}getExpressionTrackName(e){const n=this.getExpression(e);return n?`${n.name}.weight`:null}update(){const e=this._calculateWeightMultipliers();this._expressions.forEach(n=>{n.clearAppliedWeight()}),this._expressions.forEach(n=>{let i=1;const r=n.expressionName;this.blinkExpressionNames.indexOf(r)!==-1&&(i*=e.blink),this.lookAtExpressionNames.indexOf(r)!==-1&&(i*=e.lookAt),this.mouthExpressionNames.indexOf(r)!==-1&&(i*=e.mouth),n.applyWeight({multiplier:i})})}_calculateWeightMultipliers(){let e=1,n=1,i=1;return this._expressions.forEach(r=>{e-=r.overrideBlinkAmount,n-=r.overrideLookAtAmount,i-=r.overrideMouthAmount}),e=Math.max(0,e),n=Math.max(0,n),i=Math.max(0,i),{blink:e,lookAt:n,mouth:i}}},Ee={Color:"color",EmissionColor:"emissionColor",ShadeColor:"shadeColor",RimColor:"rimColor",OutlineColor:"outlineColor"},Cs={_Color:Ee.Color,_EmissionColor:Ee.EmissionColor,_ShadeColor:Ee.ShadeColor,_RimColor:Ee.RimColor,_OutlineColor:Ee.OutlineColor},Us=new O,Ti=class xi{constructor({material:e,type:n,targetValue:i,targetAlpha:r}){this.material=e,this.type=n,this.targetValue=i,this.targetAlpha=r??1;const s=this._initColorBindState(),o=this._initAlphaBindState();this._state={color:s,alpha:o}}applyWeight(e){const{color:n,alpha:i}=this._state;if(n!=null){const{propertyName:r,deltaValue:s}=n,o=this.material[r];o!=null&&o.add(Us.copy(s).multiplyScalar(e))}if(i!=null){const{propertyName:r,deltaValue:s}=i;this.material[r]!=null&&(this.material[r]+=s*e)}}clearAppliedWeight(){const{color:e,alpha:n}=this._state;if(e!=null){const{propertyName:i,initialValue:r}=e,s=this.material[i];s!=null&&s.copy(r)}if(n!=null){const{propertyName:i,initialValue:r}=n;this.material[i]!=null&&(this.material[i]=r)}}_initColorBindState(){var e,n,i;const{material:r,type:s,targetValue:o}=this,l=this._getPropertyNameMap(),a=(n=(e=l==null?void 0:l[s])==null?void 0:e[0])!=null?n:null;if(a==null)return console.warn(`Tried to add a material color bind to the material ${(i=r.name)!=null?i:"(no name)"}, the type ${s} but the material or the type is not supported.`),null;const c=r[a].clone(),d=new O(o.r-c.r,o.g-c.g,o.b-c.b);return{propertyName:a,initialValue:c,deltaValue:d}}_initAlphaBindState(){var e,n,i;const{material:r,type:s,targetAlpha:o}=this,l=this._getPropertyNameMap(),a=(n=(e=l==null?void 0:l[s])==null?void 0:e[1])!=null?n:null;if(a==null&&o!==1)return console.warn(`Tried to add a material alpha bind to the material ${(i=r.name)!=null?i:"(no name)"}, the type ${s} but the material or the type does not support alpha.`),null;if(a==null)return null;const u=r[a],c=o-u;return{propertyName:a,initialValue:u,deltaValue:c}}_getPropertyNameMap(){var e,n;return(n=(e=Object.entries(xi._propertyNameMapMap).find(([i])=>this.material[i]===!0))==null?void 0:e[1])!=null?n:null}};Ti._propertyNameMapMap={isMeshStandardMaterial:{color:["color","opacity"],emissionColor:["emissive",null]},isMeshBasicMaterial:{color:["color","opacity"]},isMToonMaterial:{color:["color","opacity"],emissionColor:["emissive",null],outlineColor:["outlineColorFactor",null],matcapColor:["matcapFactor",null],rimColor:["parametricRimColorFactor",null],shadeColor:["shadeColorFactor",null]}};var Pn=Ti,qe=class{constructor({primitives:t,index:e,weight:n}){this.primitives=t,this.index=e,this.weight=n}applyWeight(t){this.primitives.forEach(e=>{var n;((n=e.morphTargetInfluences)==null?void 0:n[this.index])!=null&&(e.morphTargetInfluences[this.index]+=this.weight*t)})}clearAppliedWeight(){this.primitives.forEach(t=>{var e;((e=t.morphTargetInfluences)==null?void 0:e[this.index])!=null&&(t.morphTargetInfluences[this.index]=0)})}},bn=new ae,yi=class Ri{constructor({material:e,scale:n,offset:i}){var r,s;this.material=e,this.scale=n,this.offset=i;const o=(r=Object.entries(Ri._propertyNamesMap).find(([l])=>e[l]===!0))==null?void 0:r[1];o==null?(console.warn(`Tried to add a texture transform bind to the material ${(s=e.name)!=null?s:"(no name)"} but the material is not supported.`),this._properties=[]):(this._properties=[],o.forEach(l=>{var a;const u=(a=e[l])==null?void 0:a.clone();if(!u)return null;e[l]=u;const c=u.offset.clone(),d=u.repeat.clone(),h=i.clone().sub(c),f=n.clone().sub(d);this._properties.push({name:l,initialOffset:c,deltaOffset:h,initialScale:d,deltaScale:f})}))}applyWeight(e){this._properties.forEach(n=>{const i=this.material[n.name];i!==void 0&&(i.offset.add(bn.copy(n.deltaOffset).multiplyScalar(e)),i.repeat.add(bn.copy(n.deltaScale).multiplyScalar(e)))})}clearAppliedWeight(){this._properties.forEach(e=>{const n=this.material[e.name];n!==void 0&&(n.offset.copy(e.initialOffset),n.repeat.copy(e.initialScale))})}};yi._propertyNamesMap={isMeshStandardMaterial:["map","emissiveMap","bumpMap","normalMap","displacementMap","roughnessMap","metalnessMap","alphaMap"],isMeshBasicMaterial:["map","specularMap","alphaMap"],isMToonMaterial:["map","normalMap","emissiveMap","shadeMultiplyTexture","rimMultiplyTexture","outlineWidthMultiplyTexture","uvAnimationMaskTexture"]};var In=yi,Vs=new Set(["1.0","1.0-beta"]),wi=class Ei{get name(){return"VRMExpressionLoaderPlugin"}constructor(e){this.parser=e}afterRoot(e){return L(this,null,function*(){e.userData.vrmExpressionManager=yield this._import(e)})}_import(e){return L(this,null,function*(){const n=yield this._v1Import(e);if(n)return n;const i=yield this._v0Import(e);return i||null})}_v1Import(e){return L(this,null,function*(){var n,i;const r=this.parser.json;if(!(((n=r.extensionsUsed)==null?void 0:n.indexOf("VRMC_vrm"))!==-1))return null;const o=(i=r.extensions)==null?void 0:i.VRMC_vrm;if(!o)return null;const l=o.specVersion;if(!Vs.has(l))return console.warn(`VRMExpressionLoaderPlugin: Unknown VRMC_vrm specVersion "${l}"`),null;const a=o.expressions;if(!a)return null;const u=new Set(Object.values(yt)),c=new Map;a.preset!=null&&Object.entries(a.preset).forEach(([h,f])=>{if(f!=null){if(!u.has(h)){console.warn(`VRMExpressionLoaderPlugin: Unknown preset name "${h}" detected. Ignoring the expression`);return}c.set(h,f)}}),a.custom!=null&&Object.entries(a.custom).forEach(([h,f])=>{if(u.has(h)){console.warn(`VRMExpressionLoaderPlugin: Custom expression cannot have preset name "${h}". Ignoring the expression`);return}c.set(h,f)});const d=new Ln;return yield Promise.all(Array.from(c.entries()).map(h=>L(this,[h],function*([f,p]){var m,g,_,y,T,M,x;const R=new En(f);if(e.scene.add(R),R.isBinary=(m=p.isBinary)!=null?m:!1,R.overrideBlink=(g=p.overrideBlink)!=null?g:"none",R.overrideLookAt=(_=p.overrideLookAt)!=null?_:"none",R.overrideMouth=(y=p.overrideMouth)!=null?y:"none",(T=p.morphTargetBinds)==null||T.forEach(w=>L(this,null,function*(){var S;if(w.node===void 0||w.index===void 0)return;const I=yield Sn(e,w.node),P=w.index;if(!I.every(b=>Array.isArray(b.morphTargetInfluences)&&P<b.morphTargetInfluences.length)){console.warn(`VRMExpressionLoaderPlugin: ${p.name} attempts to index morph #${P} but not found.`);return}R.addBind(new qe({primitives:I,index:P,weight:(S=w.weight)!=null?S:1}))})),p.materialColorBinds||p.textureTransformBinds){const w=[];e.scene.traverse(S=>{const I=S.material;I&&(Array.isArray(I)?w.push(...I):w.push(I))}),(M=p.materialColorBinds)==null||M.forEach(S=>L(this,null,function*(){w.filter(P=>{var b;const V=(b=this.parser.associations.get(P))==null?void 0:b.materials;return S.material===V}).forEach(P=>{R.addBind(new Pn({material:P,type:S.type,targetValue:new O().fromArray(S.targetValue),targetAlpha:S.targetValue[3]}))})})),(x=p.textureTransformBinds)==null||x.forEach(S=>L(this,null,function*(){w.filter(P=>{var b;const V=(b=this.parser.associations.get(P))==null?void 0:b.materials;return S.material===V}).forEach(P=>{var b,V;R.addBind(new In({material:P,offset:new ae().fromArray((b=S.offset)!=null?b:[0,0]),scale:new ae().fromArray((V=S.scale)!=null?V:[1,1])}))})}))}d.registerExpression(R)}))),d})}_v0Import(e){return L(this,null,function*(){var n;const i=this.parser.json,r=(n=i.extensions)==null?void 0:n.VRM;if(!r)return null;const s=r.blendShapeMaster;if(!s)return null;const o=new Ln,l=s.blendShapeGroups;if(!l)return o;const a=new Set;return yield Promise.all(l.map(u=>L(this,null,function*(){var c;const d=u.presetName,h=d!=null&&Ei.v0v1PresetNameMap[d]||null,f=h??u.name;if(f==null){console.warn("VRMExpressionLoaderPlugin: One of custom expressions has no name. Ignoring the expression");return}if(a.has(f)){console.warn(`VRMExpressionLoaderPlugin: An expression preset ${d} has duplicated entries. Ignoring the expression`);return}a.add(f);const p=new En(f);e.scene.add(p),p.isBinary=(c=u.isBinary)!=null?c:!1,u.binds&&u.binds.forEach(g=>L(this,null,function*(){var _;if(g.mesh===void 0||g.index===void 0)return;const y=[];(_=i.nodes)==null||_.forEach((M,x)=>{M.mesh===g.mesh&&y.push(x)});const T=g.index;yield Promise.all(y.map(M=>L(this,null,function*(){var x;const R=yield Sn(e,M);if(!R.every(w=>Array.isArray(w.morphTargetInfluences)&&T<w.morphTargetInfluences.length)){console.warn(`VRMExpressionLoaderPlugin: ${u.name} attempts to index ${T}th morph but not found.`);return}p.addBind(new qe({primitives:R,index:T,weight:.01*((x=g.weight)!=null?x:100)}))})))}));const m=u.materialValues;m&&m.length!==0&&m.forEach(g=>{if(g.materialName===void 0||g.propertyName===void 0||g.targetValue===void 0)return;const _=[];e.scene.traverse(T=>{if(T.material){const M=T.material;Array.isArray(M)?_.push(...M.filter(x=>(x.name===g.materialName||x.name===g.materialName+" (Outline)")&&_.indexOf(x)===-1)):M.name===g.materialName&&_.indexOf(M)===-1&&_.push(M)}});const y=g.propertyName;_.forEach(T=>{if(y==="_MainTex_ST"){const x=new ae(g.targetValue[0],g.targetValue[1]),R=new ae(g.targetValue[2],g.targetValue[3]);R.y=1-R.y-x.y,p.addBind(new In({material:T,scale:x,offset:R}));return}const M=Cs[y];if(M){p.addBind(new Pn({material:T,type:M,targetValue:new O().fromArray(g.targetValue),targetAlpha:g.targetValue[3]}));return}console.warn(y+" is not supported")})}),o.registerExpression(p)}))),o})}};wi.v0v1PresetNameMap={a:"aa",e:"ee",i:"ih",o:"oh",u:"ou",blink:"blink",joy:"happy",angry:"angry",sorrow:"sad",fun:"relaxed",lookup:"lookUp",lookdown:"lookDown",lookleft:"lookLeft",lookright:"lookRight",blink_l:"blinkLeft",blink_r:"blinkRight",neutral:"neutral"};var Ds=wi,It=class me{constructor(e,n){this._firstPersonOnlyLayer=me.DEFAULT_FIRSTPERSON_ONLY_LAYER,this._thirdPersonOnlyLayer=me.DEFAULT_THIRDPERSON_ONLY_LAYER,this._initializedLayers=!1,this.humanoid=e,this.meshAnnotations=n}copy(e){if(this.humanoid!==e.humanoid)throw new Error("VRMFirstPerson: humanoid must be same in order to copy");return this.meshAnnotations=e.meshAnnotations.map(n=>({meshes:n.meshes.concat(),type:n.type})),this}clone(){return new me(this.humanoid,this.meshAnnotations).copy(this)}get firstPersonOnlyLayer(){return this._firstPersonOnlyLayer}get thirdPersonOnlyLayer(){return this._thirdPersonOnlyLayer}setup({firstPersonOnlyLayer:e=me.DEFAULT_FIRSTPERSON_ONLY_LAYER,thirdPersonOnlyLayer:n=me.DEFAULT_THIRDPERSON_ONLY_LAYER}={}){this._initializedLayers||(this._firstPersonOnlyLayer=e,this._thirdPersonOnlyLayer=n,this.meshAnnotations.forEach(i=>{i.meshes.forEach(r=>{i.type==="firstPersonOnly"?(r.layers.set(this._firstPersonOnlyLayer),r.traverse(s=>s.layers.set(this._firstPersonOnlyLayer))):i.type==="thirdPersonOnly"?(r.layers.set(this._thirdPersonOnlyLayer),r.traverse(s=>s.layers.set(this._thirdPersonOnlyLayer))):i.type==="auto"&&this._createHeadlessModel(r)})}),this._initializedLayers=!0)}_excludeTriangles(e,n,i,r){let s=0;if(n!=null&&n.length>0)for(let o=0;o<e.length;o+=3){const l=e[o],a=e[o+1],u=e[o+2],c=n[l],d=i[l];if(c[0]>0&&r.includes(d[0])||c[1]>0&&r.includes(d[1])||c[2]>0&&r.includes(d[2])||c[3]>0&&r.includes(d[3]))continue;const h=n[a],f=i[a];if(h[0]>0&&r.includes(f[0])||h[1]>0&&r.includes(f[1])||h[2]>0&&r.includes(f[2])||h[3]>0&&r.includes(f[3]))continue;const p=n[u],m=i[u];p[0]>0&&r.includes(m[0])||p[1]>0&&r.includes(m[1])||p[2]>0&&r.includes(m[2])||p[3]>0&&r.includes(m[3])||(e[s++]=l,e[s++]=a,e[s++]=u)}return s}_createErasedMesh(e,n){const i=new di(e.geometry.clone(),e.material);i.name=`${e.name}(erase)`,i.frustumCulled=e.frustumCulled,i.layers.set(this._firstPersonOnlyLayer);const r=i.geometry,s=r.getAttribute("skinIndex"),o=s instanceof _n?[]:s.array,l=[];for(let m=0;m<o.length;m+=4)l.push([o[m],o[m+1],o[m+2],o[m+3]]);const a=r.getAttribute("skinWeight"),u=a instanceof _n?[]:a.array,c=[];for(let m=0;m<u.length;m+=4)c.push([u[m],u[m+1],u[m+2],u[m+3]]);const d=r.getIndex();if(!d)throw new Error("The geometry doesn't have an index buffer");const h=Array.from(d.array),f=this._excludeTriangles(h,c,l,n),p=[];for(let m=0;m<f;m++)p[m]=h[m];return r.setIndex(p),e.onBeforeRender&&(i.onBeforeRender=e.onBeforeRender),i.bind(new $e(e.skeleton.bones,e.skeleton.boneInverses),new F),i}_createHeadlessModelForSkinnedMesh(e,n){const i=[];if(n.skeleton.bones.forEach((s,o)=>{this._isEraseTarget(s)&&i.push(o)}),!i.length){n.layers.enable(this._thirdPersonOnlyLayer),n.layers.enable(this._firstPersonOnlyLayer);return}n.layers.set(this._thirdPersonOnlyLayer);const r=this._createErasedMesh(n,i);e.add(r)}_createHeadlessModel(e){if(e.type==="Group")if(e.layers.set(this._thirdPersonOnlyLayer),this._isEraseTarget(e))e.traverse(n=>n.layers.set(this._thirdPersonOnlyLayer));else{const n=new q;n.name=`_headless_${e.name}`,n.layers.set(this._firstPersonOnlyLayer),e.parent.add(n),e.children.filter(i=>i.type==="SkinnedMesh").forEach(i=>{const r=i;this._createHeadlessModelForSkinnedMesh(n,r)})}else if(e.type==="SkinnedMesh"){const n=e;this._createHeadlessModelForSkinnedMesh(e.parent,n)}else this._isEraseTarget(e)&&(e.layers.set(this._thirdPersonOnlyLayer),e.traverse(n=>n.layers.set(this._thirdPersonOnlyLayer)))}_isEraseTarget(e){return e===this.humanoid.getRawBoneNode("head")?!0:e.parent?this._isEraseTarget(e.parent):!1}};It.DEFAULT_FIRSTPERSON_ONLY_LAYER=9;It.DEFAULT_THIRDPERSON_ONLY_LAYER=10;var On=It,Fs=new Set(["1.0","1.0-beta"]),Bs=class{get name(){return"VRMFirstPersonLoaderPlugin"}constructor(t){this.parser=t}afterRoot(t){return L(this,null,function*(){const e=t.userData.vrmHumanoid;if(e!==null){if(e===void 0)throw new Error("VRMFirstPersonLoaderPlugin: vrmHumanoid is undefined. VRMHumanoidLoaderPlugin have to be used first");t.userData.vrmFirstPerson=yield this._import(t,e)}})}_import(t,e){return L(this,null,function*(){if(e==null)return null;const n=yield this._v1Import(t,e);if(n)return n;const i=yield this._v0Import(t,e);return i||null})}_v1Import(t,e){return L(this,null,function*(){var n,i;const r=this.parser.json;if(!(((n=r.extensionsUsed)==null?void 0:n.indexOf("VRMC_vrm"))!==-1))return null;const o=(i=r.extensions)==null?void 0:i.VRMC_vrm;if(!o)return null;const l=o.specVersion;if(!Fs.has(l))return console.warn(`VRMFirstPersonLoaderPlugin: Unknown VRMC_vrm specVersion "${l}"`),null;const a=o.firstPerson,u=[],c=yield An(t);return Array.from(c.entries()).forEach(([d,h])=>{var f,p;const m=(f=a==null?void 0:a.meshAnnotations)==null?void 0:f.find(g=>g.node===d);u.push({meshes:h,type:(p=m==null?void 0:m.type)!=null?p:"auto"})}),new On(e,u)})}_v0Import(t,e){return L(this,null,function*(){var n;const i=this.parser.json,r=(n=i.extensions)==null?void 0:n.VRM;if(!r)return null;const s=r.firstPerson;if(!s)return null;const o=[],l=yield An(t);return Array.from(l.entries()).forEach(([a,u])=>{const c=i.nodes[a],d=s.meshAnnotations?s.meshAnnotations.find(h=>h.mesh===c.mesh):void 0;o.push({meshes:u,type:this._convertV0FlagToV1Type(d==null?void 0:d.firstPersonFlag)})}),new On(e,o)})}_convertV0FlagToV1Type(t){return t==="FirstPersonOnly"?"firstPersonOnly":t==="ThirdPersonOnly"?"thirdPersonOnly":t==="Both"?"both":"auto"}},Nn=new v,Cn=new v,Hs=new A,Un=class extends q{constructor(t){super(),this.vrmHumanoid=t,this._boneAxesMap=new Map,Object.values(t.humanBones).forEach(e=>{const n=new Qr(1);n.matrixAutoUpdate=!1,n.material.depthTest=!1,n.material.depthWrite=!1,this.add(n),this._boneAxesMap.set(e,n)})}dispose(){Array.from(this._boneAxesMap.values()).forEach(t=>{t.geometry.dispose(),t.material.dispose()})}updateMatrixWorld(t){Array.from(this._boneAxesMap.entries()).forEach(([e,n])=>{e.node.updateWorldMatrix(!0,!1),e.node.matrixWorld.decompose(Nn,Hs,Cn);const i=Nn.set(.1,.1,.1).divide(Cn);n.matrix.copy(e.node.matrixWorld).scale(i)}),super.updateMatrixWorld(t)}},rt=["hips","spine","chest","upperChest","neck","head","leftEye","rightEye","jaw","leftUpperLeg","leftLowerLeg","leftFoot","leftToes","rightUpperLeg","rightLowerLeg","rightFoot","rightToes","leftShoulder","leftUpperArm","leftLowerArm","leftHand","rightShoulder","rightUpperArm","rightLowerArm","rightHand","leftThumbMetacarpal","leftThumbProximal","leftThumbDistal","leftIndexProximal","leftIndexIntermediate","leftIndexDistal","leftMiddleProximal","leftMiddleIntermediate","leftMiddleDistal","leftRingProximal","leftRingIntermediate","leftRingDistal","leftLittleProximal","leftLittleIntermediate","leftLittleDistal","rightThumbMetacarpal","rightThumbProximal","rightThumbDistal","rightIndexProximal","rightIndexIntermediate","rightIndexDistal","rightMiddleProximal","rightMiddleIntermediate","rightMiddleDistal","rightRingProximal","rightRingIntermediate","rightRingDistal","rightLittleProximal","rightLittleIntermediate","rightLittleDistal"],ks={hips:null,spine:"hips",chest:"spine",upperChest:"chest",neck:"upperChest",head:"neck",leftEye:"head",rightEye:"head",jaw:"head",leftUpperLeg:"hips",leftLowerLeg:"leftUpperLeg",leftFoot:"leftLowerLeg",leftToes:"leftFoot",rightUpperLeg:"hips",rightLowerLeg:"rightUpperLeg",rightFoot:"rightLowerLeg",rightToes:"rightFoot",leftShoulder:"upperChest",leftUpperArm:"leftShoulder",leftLowerArm:"leftUpperArm",leftHand:"leftLowerArm",rightShoulder:"upperChest",rightUpperArm:"rightShoulder",rightLowerArm:"rightUpperArm",rightHand:"rightLowerArm",leftThumbMetacarpal:"leftHand",leftThumbProximal:"leftThumbMetacarpal",leftThumbDistal:"leftThumbProximal",leftIndexProximal:"leftHand",leftIndexIntermediate:"leftIndexProximal",leftIndexDistal:"leftIndexIntermediate",leftMiddleProximal:"leftHand",leftMiddleIntermediate:"leftMiddleProximal",leftMiddleDistal:"leftMiddleIntermediate",leftRingProximal:"leftHand",leftRingIntermediate:"leftRingProximal",leftRingDistal:"leftRingIntermediate",leftLittleProximal:"leftHand",leftLittleIntermediate:"leftLittleProximal",leftLittleDistal:"leftLittleIntermediate",rightThumbMetacarpal:"rightHand",rightThumbProximal:"rightThumbMetacarpal",rightThumbDistal:"rightThumbProximal",rightIndexProximal:"rightHand",rightIndexIntermediate:"rightIndexProximal",rightIndexDistal:"rightIndexIntermediate",rightMiddleProximal:"rightHand",rightMiddleIntermediate:"rightMiddleProximal",rightMiddleDistal:"rightMiddleIntermediate",rightRingProximal:"rightHand",rightRingIntermediate:"rightRingProximal",rightRingDistal:"rightRingIntermediate",rightLittleProximal:"rightHand",rightLittleIntermediate:"rightLittleProximal",rightLittleDistal:"rightLittleIntermediate"};function Si(t){return t.invert?t.invert():t.inverse(),t}var re=new v,se=new A,Rt=class{constructor(t){this.humanBones=t,this.restPose=this.getAbsolutePose()}getAbsolutePose(){const t={};return Object.keys(this.humanBones).forEach(e=>{const n=e,i=this.getBoneNode(n);i&&(re.copy(i.position),se.copy(i.quaternion),t[n]={position:re.toArray(),rotation:se.toArray()})}),t}getPose(){const t={};return Object.keys(this.humanBones).forEach(e=>{const n=e,i=this.getBoneNode(n);if(!i)return;re.set(0,0,0),se.identity();const r=this.restPose[n];r!=null&&r.position&&re.fromArray(r.position).negate(),r!=null&&r.rotation&&Si(se.fromArray(r.rotation)),re.add(i.position),se.premultiply(i.quaternion),t[n]={position:re.toArray(),rotation:se.toArray()}}),t}setPose(t){Object.entries(t).forEach(([e,n])=>{const i=e,r=this.getBoneNode(i);if(!r)return;const s=this.restPose[i];s&&(n!=null&&n.position&&(r.position.fromArray(n.position),s.position&&r.position.add(re.fromArray(s.position))),n!=null&&n.rotation&&(r.quaternion.fromArray(n.rotation),s.rotation&&r.quaternion.multiply(se.fromArray(s.rotation))))})}resetPose(){Object.entries(this.restPose).forEach(([t,e])=>{const n=this.getBoneNode(t);n&&(e!=null&&e.position&&n.position.fromArray(e.position),e!=null&&e.rotation&&n.quaternion.fromArray(e.rotation))})}getBone(t){var e;return(e=this.humanBones[t])!=null?e:void 0}getBoneNode(t){var e,n;return(n=(e=this.humanBones[t])==null?void 0:e.node)!=null?n:null}},st=new v,Ws=new A,Gs=new v,Vn=class Ai extends Rt{static _setupTransforms(e){const n=new ve;n.name="VRMHumanoidRig";const i={},r={},s={};rt.forEach(l=>{var a;const u=e.getBoneNode(l);if(u){const c=new v,d=new A;u.updateWorldMatrix(!0,!1),u.matrixWorld.decompose(c,d,st),i[l]=c,r[l]=u.quaternion.clone();const h=new A;(a=u.parent)==null||a.matrixWorld.decompose(st,h,st),s[l]=h}});const o={};return rt.forEach(l=>{var a;const u=e.getBoneNode(l);if(u){const c=i[l];let d=l,h;for(;h==null&&(d=ks[d],d!=null);)h=i[d];const f=new ve;f.name="Normalized_"+u.name,(d?(a=o[d])==null?void 0:a.node:n).add(f),f.position.copy(c),h&&f.position.sub(h),o[l]={node:f}}}),{rigBones:o,root:n,parentWorldRotations:s,boneRotations:r}}constructor(e){const{rigBones:n,root:i,parentWorldRotations:r,boneRotations:s}=Ai._setupTransforms(e);super(n),this.original=e,this.root=i,this._parentWorldRotations=r,this._boneRotations=s}update(){rt.forEach(e=>{const n=this.original.getBoneNode(e);if(n!=null){const i=this.getBoneNode(e),r=this._parentWorldRotations[e],s=Ws.copy(r).invert(),o=this._boneRotations[e];if(n.quaternion.copy(i.quaternion).multiply(r).premultiply(s).multiply(o),e==="hips"){const l=i.getWorldPosition(Gs);n.parent.updateWorldMatrix(!0,!1);const a=n.parent.matrixWorld,u=l.applyMatrix4(a.invert());n.position.copy(u)}}})}},Dn=class Li{get restPose(){return console.warn("VRMHumanoid: restPose is deprecated. Use either rawRestPose or normalizedRestPose instead."),this.rawRestPose}get rawRestPose(){return this._rawHumanBones.restPose}get normalizedRestPose(){return this._normalizedHumanBones.restPose}get humanBones(){return this._rawHumanBones.humanBones}get rawHumanBones(){return this._rawHumanBones.humanBones}get normalizedHumanBones(){return this._normalizedHumanBones.humanBones}get normalizedHumanBonesRoot(){return this._normalizedHumanBones.root}constructor(e,n){var i;this.autoUpdateHumanBones=(i=n==null?void 0:n.autoUpdateHumanBones)!=null?i:!0,this._rawHumanBones=new Rt(e),this._normalizedHumanBones=new Vn(this._rawHumanBones)}copy(e){return this.autoUpdateHumanBones=e.autoUpdateHumanBones,this._rawHumanBones=new Rt(e.humanBones),this._normalizedHumanBones=new Vn(this._rawHumanBones),this}clone(){return new Li(this.humanBones,{autoUpdateHumanBones:this.autoUpdateHumanBones}).copy(this)}getAbsolutePose(){return console.warn("VRMHumanoid: getAbsolutePose() is deprecated. Use either getRawAbsolutePose() or getNormalizedAbsolutePose() instead."),this.getRawAbsolutePose()}getRawAbsolutePose(){return this._rawHumanBones.getAbsolutePose()}getNormalizedAbsolutePose(){return this._normalizedHumanBones.getAbsolutePose()}getPose(){return console.warn("VRMHumanoid: getPose() is deprecated. Use either getRawPose() or getNormalizedPose() instead."),this.getRawPose()}getRawPose(){return this._rawHumanBones.getPose()}getNormalizedPose(){return this._normalizedHumanBones.getPose()}setPose(e){return console.warn("VRMHumanoid: setPose() is deprecated. Use either setRawPose() or setNormalizedPose() instead."),this.setRawPose(e)}setRawPose(e){return this._rawHumanBones.setPose(e)}setNormalizedPose(e){return this._normalizedHumanBones.setPose(e)}resetPose(){return console.warn("VRMHumanoid: resetPose() is deprecated. Use either resetRawPose() or resetNormalizedPose() instead."),this.resetRawPose()}resetRawPose(){return this._rawHumanBones.resetPose()}resetNormalizedPose(){return this._normalizedHumanBones.resetPose()}getBone(e){return console.warn("VRMHumanoid: getBone() is deprecated. Use either getRawBone() or getNormalizedBone() instead."),this.getRawBone(e)}getRawBone(e){return this._rawHumanBones.getBone(e)}getNormalizedBone(e){return this._normalizedHumanBones.getBone(e)}getBoneNode(e){return console.warn("VRMHumanoid: getBoneNode() is deprecated. Use either getRawBoneNode() or getNormalizedBoneNode() instead."),this.getRawBoneNode(e)}getRawBoneNode(e){return this._rawHumanBones.getBoneNode(e)}getNormalizedBoneNode(e){return this._normalizedHumanBones.getBoneNode(e)}update(){this.autoUpdateHumanBones&&this._normalizedHumanBones.update()}},zs={Hips:"hips",Spine:"spine",Head:"head",LeftUpperLeg:"leftUpperLeg",LeftLowerLeg:"leftLowerLeg",LeftFoot:"leftFoot",RightUpperLeg:"rightUpperLeg",RightLowerLeg:"rightLowerLeg",RightFoot:"rightFoot",LeftUpperArm:"leftUpperArm",LeftLowerArm:"leftLowerArm",LeftHand:"leftHand",RightUpperArm:"rightUpperArm",RightLowerArm:"rightLowerArm",RightHand:"rightHand"},js=new Set(["1.0","1.0-beta"]),Fn={leftThumbProximal:"leftThumbMetacarpal",leftThumbIntermediate:"leftThumbProximal",rightThumbProximal:"rightThumbMetacarpal",rightThumbIntermediate:"rightThumbProximal"},Xs=class{get name(){return"VRMHumanoidLoaderPlugin"}constructor(t,e){this.parser=t,this.helperRoot=e==null?void 0:e.helperRoot,this.autoUpdateHumanBones=e==null?void 0:e.autoUpdateHumanBones}afterRoot(t){return L(this,null,function*(){t.userData.vrmHumanoid=yield this._import(t)})}_import(t){return L(this,null,function*(){const e=yield this._v1Import(t);if(e)return e;const n=yield this._v0Import(t);return n||null})}_v1Import(t){return L(this,null,function*(){var e,n;const i=this.parser.json;if(!(((e=i.extensionsUsed)==null?void 0:e.indexOf("VRMC_vrm"))!==-1))return null;const s=(n=i.extensions)==null?void 0:n.VRMC_vrm;if(!s)return null;const o=s.specVersion;if(!js.has(o))return console.warn(`VRMHumanoidLoaderPlugin: Unknown VRMC_vrm specVersion "${o}"`),null;const l=s.humanoid;if(!l)return null;const a=l.humanBones.leftThumbIntermediate!=null||l.humanBones.rightThumbIntermediate!=null,u={};l.humanBones!=null&&(yield Promise.all(Object.entries(l.humanBones).map(d=>L(this,[d],function*([h,f]){let p=h;const m=f.node;if(a){const _=Fn[p];_!=null&&(p=_)}const g=yield this.parser.getDependency("node",m);if(g==null){console.warn(`A glTF node bound to the humanoid bone ${p} (index = ${m}) does not exist`);return}u[p]={node:g}}))));const c=new Dn(this._ensureRequiredBonesExist(u),{autoUpdateHumanBones:this.autoUpdateHumanBones});if(t.scene.add(c.normalizedHumanBonesRoot),this.helperRoot){const d=new Un(c);this.helperRoot.add(d),d.renderOrder=this.helperRoot.renderOrder}return c})}_v0Import(t){return L(this,null,function*(){var e;const i=(e=this.parser.json.extensions)==null?void 0:e.VRM;if(!i)return null;const r=i.humanoid;if(!r)return null;const s={};r.humanBones!=null&&(yield Promise.all(r.humanBones.map(l=>L(this,null,function*(){const a=l.bone,u=l.node;if(a==null||u==null)return;const c=yield this.parser.getDependency("node",u);if(c==null){console.warn(`A glTF node bound to the humanoid bone ${a} (index = ${u}) does not exist`);return}const d=Fn[a],h=d??a;if(s[h]!=null){console.warn(`Multiple bone entries for ${h} detected (index = ${u}), ignoring duplicated entries.`);return}s[h]={node:c}}))));const o=new Dn(this._ensureRequiredBonesExist(s),{autoUpdateHumanBones:this.autoUpdateHumanBones});if(t.scene.add(o.normalizedHumanBonesRoot),this.helperRoot){const l=new Un(o);this.helperRoot.add(l),l.renderOrder=this.helperRoot.renderOrder}return o})}_ensureRequiredBonesExist(t){const e=Object.values(zs).filter(n=>t[n]==null);if(e.length>0)throw new Error(`VRMHumanoidLoaderPlugin: These humanoid bones are required but not exist: ${e.join(", ")}`);return t}},Bn=class extends K{constructor(){super(),this._currentTheta=0,this._currentRadius=0,this.theta=0,this.radius=0,this._currentTheta=0,this._currentRadius=0,this._attrPos=new U(new Float32Array(195),3),this.setAttribute("position",this._attrPos),this._attrIndex=new U(new Uint16Array(189),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let t=!1;this._currentTheta!==this.theta&&(this._currentTheta=this.theta,t=!0),this._currentRadius!==this.radius&&(this._currentRadius=this.radius,t=!0),t&&this._buildPosition()}_buildPosition(){this._attrPos.setXYZ(0,0,0,0);for(let t=0;t<64;t++){const e=t/63*this._currentTheta;this._attrPos.setXYZ(t+1,this._currentRadius*Math.sin(e),0,this._currentRadius*Math.cos(e))}this._attrPos.needsUpdate=!0}_buildIndex(){for(let t=0;t<63;t++)this._attrIndex.setXYZ(t*3,0,t+1,t+2);this._attrIndex.needsUpdate=!0}},qs=class extends K{constructor(){super(),this.radius=0,this._currentRadius=0,this.tail=new v,this._currentTail=new v,this._attrPos=new U(new Float32Array(294),3),this.setAttribute("position",this._attrPos),this._attrIndex=new U(new Uint16Array(194),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let t=!1;this._currentRadius!==this.radius&&(this._currentRadius=this.radius,t=!0),this._currentTail.equals(this.tail)||(this._currentTail.copy(this.tail),t=!0),t&&this._buildPosition()}_buildPosition(){for(let t=0;t<32;t++){const e=t/16*Math.PI;this._attrPos.setXYZ(t,Math.cos(e),Math.sin(e),0),this._attrPos.setXYZ(32+t,0,Math.cos(e),Math.sin(e)),this._attrPos.setXYZ(64+t,Math.sin(e),0,Math.cos(e))}this.scale(this._currentRadius,this._currentRadius,this._currentRadius),this.translate(this._currentTail.x,this._currentTail.y,this._currentTail.z),this._attrPos.setXYZ(96,0,0,0),this._attrPos.setXYZ(97,this._currentTail.x,this._currentTail.y,this._currentTail.z),this._attrPos.needsUpdate=!0}_buildIndex(){for(let t=0;t<32;t++){const e=(t+1)%32;this._attrIndex.setXY(t*2,t,e),this._attrIndex.setXY(64+t*2,32+t,32+e),this._attrIndex.setXY(128+t*2,64+t,64+e)}this._attrIndex.setXY(192,96,97),this._attrIndex.needsUpdate=!0}},Fe=new A,Hn=new A,Se=new v,kn=new v,Wn=Math.sqrt(2)/2,Ys=new A(0,0,-Wn,Wn),Ks=new v(0,1,0),Qs=class extends q{constructor(t){super(),this.matrixAutoUpdate=!1,this.vrmLookAt=t;{const e=new Bn;e.radius=.5;const n=new le({color:65280,transparent:!0,opacity:.5,side:Mt,depthTest:!1,depthWrite:!1});this._meshPitch=new ue(e,n),this.add(this._meshPitch)}{const e=new Bn;e.radius=.5;const n=new le({color:16711680,transparent:!0,opacity:.5,side:Mt,depthTest:!1,depthWrite:!1});this._meshYaw=new ue(e,n),this.add(this._meshYaw)}{const e=new qs;e.radius=.1;const n=new Ne({color:16777215,depthTest:!1,depthWrite:!1});this._lineTarget=new Ze(e,n),this._lineTarget.frustumCulled=!1,this.add(this._lineTarget)}}dispose(){this._meshYaw.geometry.dispose(),this._meshYaw.material.dispose(),this._meshPitch.geometry.dispose(),this._meshPitch.material.dispose(),this._lineTarget.geometry.dispose(),this._lineTarget.material.dispose()}updateMatrixWorld(t){const e=N.DEG2RAD*this.vrmLookAt.yaw;this._meshYaw.geometry.theta=e,this._meshYaw.geometry.update();const n=N.DEG2RAD*this.vrmLookAt.pitch;this._meshPitch.geometry.theta=n,this._meshPitch.geometry.update(),this.vrmLookAt.getLookAtWorldPosition(Se),this.vrmLookAt.getLookAtWorldQuaternion(Fe),Fe.multiply(this.vrmLookAt.getFaceFrontQuaternion(Hn)),this._meshYaw.position.copy(Se),this._meshYaw.quaternion.copy(Fe),this._meshPitch.position.copy(Se),this._meshPitch.quaternion.copy(Fe),this._meshPitch.quaternion.multiply(Hn.setFromAxisAngle(Ks,e)),this._meshPitch.quaternion.multiply(Ys);const{target:i,autoUpdate:r}=this.vrmLookAt;i!=null&&r&&(i.getWorldPosition(kn).sub(Se),this._lineTarget.geometry.tail.copy(kn),this._lineTarget.geometry.update(),this._lineTarget.position.copy(Se)),super.updateMatrixWorld(t)}},Zs=new v,$s=new v;function wt(t,e){return t.matrixWorld.decompose(Zs,e,$s),e}function We(t){return[Math.atan2(-t.z,t.x),Math.atan2(t.y,Math.sqrt(t.x*t.x+t.z*t.z))]}function Gn(t){const e=Math.round(t/2/Math.PI);return t-2*Math.PI*e}var zn=new v(0,0,1),Js=new v,eo=new v,to=new v,no=new A,ot=new A,jn=new A,io=new A,at=new bt,Pi=class bi{constructor(e,n){this.offsetFromHeadBone=new v,this.autoUpdate=!0,this.faceFront=new v(0,0,1),this.humanoid=e,this.applier=n,this._yaw=0,this._pitch=0,this._needsUpdate=!0,this._restHeadWorldQuaternion=this.getLookAtWorldQuaternion(new A)}get yaw(){return this._yaw}set yaw(e){this._yaw=e,this._needsUpdate=!0}get pitch(){return this._pitch}set pitch(e){this._pitch=e,this._needsUpdate=!0}get euler(){return console.warn("VRMLookAt: euler is deprecated. use getEuler() instead."),this.getEuler(new bt)}getEuler(e){return e.set(N.DEG2RAD*this._pitch,N.DEG2RAD*this._yaw,0,"YXZ")}copy(e){if(this.humanoid!==e.humanoid)throw new Error("VRMLookAt: humanoid must be same in order to copy");return this.offsetFromHeadBone.copy(e.offsetFromHeadBone),this.applier=e.applier,this.autoUpdate=e.autoUpdate,this.target=e.target,this.faceFront.copy(e.faceFront),this}clone(){return new bi(this.humanoid,this.applier).copy(this)}reset(){this._yaw=0,this._pitch=0,this._needsUpdate=!0}getLookAtWorldPosition(e){const n=this.humanoid.getRawBoneNode("head");return e.copy(this.offsetFromHeadBone).applyMatrix4(n.matrixWorld)}getLookAtWorldQuaternion(e){const n=this.humanoid.getRawBoneNode("head");return wt(n,e)}getFaceFrontQuaternion(e){if(this.faceFront.distanceToSquared(zn)<.01)return e.copy(this._restHeadWorldQuaternion).invert();const[n,i]=We(this.faceFront);return at.set(0,.5*Math.PI+n,i,"YZX"),e.setFromEuler(at).premultiply(io.copy(this._restHeadWorldQuaternion).invert())}getLookAtWorldDirection(e){return this.getLookAtWorldQuaternion(ot),this.getFaceFrontQuaternion(jn),e.copy(zn).applyQuaternion(ot).applyQuaternion(jn).applyEuler(this.getEuler(at))}lookAt(e){const n=no.copy(this._restHeadWorldQuaternion).multiply(Si(this.getLookAtWorldQuaternion(ot))),i=this.getLookAtWorldPosition(eo),r=to.copy(e).sub(i).applyQuaternion(n).normalize(),[s,o]=We(this.faceFront),[l,a]=We(r),u=Gn(l-s),c=Gn(o-a);this._yaw=N.RAD2DEG*u,this._pitch=N.RAD2DEG*c,this._needsUpdate=!0}update(e){this.target!=null&&this.autoUpdate&&this.lookAt(this.target.getWorldPosition(Js)),this._needsUpdate&&(this._needsUpdate=!1,this.applier.applyYawPitch(this._yaw,this._pitch))}};Pi.EULER_ORDER="YXZ";var ro=Pi,so=new v(0,0,1),W=new A,he=new A,B=new bt(0,0,0,"YXZ"),Ge=class{constructor(t,e,n,i,r){this.humanoid=t,this.rangeMapHorizontalInner=e,this.rangeMapHorizontalOuter=n,this.rangeMapVerticalDown=i,this.rangeMapVerticalUp=r,this.faceFront=new v(0,0,1),this._restQuatLeftEye=new A,this._restQuatRightEye=new A,this._restLeftEyeParentWorldQuat=new A,this._restRightEyeParentWorldQuat=new A;const s=this.humanoid.getRawBoneNode("leftEye"),o=this.humanoid.getRawBoneNode("rightEye");s&&(this._restQuatLeftEye.copy(s.quaternion),wt(s.parent,this._restLeftEyeParentWorldQuat)),o&&(this._restQuatRightEye.copy(o.quaternion),wt(o.parent,this._restRightEyeParentWorldQuat))}applyYawPitch(t,e){const n=this.humanoid.getRawBoneNode("leftEye"),i=this.humanoid.getRawBoneNode("rightEye"),r=this.humanoid.getNormalizedBoneNode("leftEye"),s=this.humanoid.getNormalizedBoneNode("rightEye");n&&(e<0?B.x=-N.DEG2RAD*this.rangeMapVerticalDown.map(-e):B.x=N.DEG2RAD*this.rangeMapVerticalUp.map(e),t<0?B.y=-N.DEG2RAD*this.rangeMapHorizontalInner.map(-t):B.y=N.DEG2RAD*this.rangeMapHorizontalOuter.map(t),W.setFromEuler(B),this._getWorldFaceFrontQuat(he),r.quaternion.copy(he).multiply(W).multiply(he.invert()),W.copy(this._restLeftEyeParentWorldQuat),n.quaternion.copy(r.quaternion).multiply(W).premultiply(W.invert()).multiply(this._restQuatLeftEye)),i&&(e<0?B.x=-N.DEG2RAD*this.rangeMapVerticalDown.map(-e):B.x=N.DEG2RAD*this.rangeMapVerticalUp.map(e),t<0?B.y=-N.DEG2RAD*this.rangeMapHorizontalOuter.map(-t):B.y=N.DEG2RAD*this.rangeMapHorizontalInner.map(t),W.setFromEuler(B),this._getWorldFaceFrontQuat(he),s.quaternion.copy(he).multiply(W).multiply(he.invert()),W.copy(this._restRightEyeParentWorldQuat),i.quaternion.copy(s.quaternion).multiply(W).premultiply(W.invert()).multiply(this._restQuatRightEye))}lookAt(t){console.warn("VRMLookAtBoneApplier: lookAt() is deprecated. use apply() instead.");const e=N.RAD2DEG*t.y,n=N.RAD2DEG*t.x;this.applyYawPitch(e,n)}_getWorldFaceFrontQuat(t){if(this.faceFront.distanceToSquared(so)<.01)return t.identity();const[e,n]=We(this.faceFront);return B.set(0,.5*Math.PI+e,n,"YZX"),t.setFromEuler(B)}};Ge.type="bone";var Et=class{constructor(t,e,n,i,r){this.expressions=t,this.rangeMapHorizontalInner=e,this.rangeMapHorizontalOuter=n,this.rangeMapVerticalDown=i,this.rangeMapVerticalUp=r}applyYawPitch(t,e){e<0?(this.expressions.setValue("lookDown",0),this.expressions.setValue("lookUp",this.rangeMapVerticalUp.map(-e))):(this.expressions.setValue("lookUp",0),this.expressions.setValue("lookDown",this.rangeMapVerticalDown.map(e))),t<0?(this.expressions.setValue("lookLeft",0),this.expressions.setValue("lookRight",this.rangeMapHorizontalOuter.map(-t))):(this.expressions.setValue("lookRight",0),this.expressions.setValue("lookLeft",this.rangeMapHorizontalOuter.map(t)))}lookAt(t){console.warn("VRMLookAtBoneApplier: lookAt() is deprecated. use apply() instead.");const e=N.RAD2DEG*t.y,n=N.RAD2DEG*t.x;this.applyYawPitch(e,n)}};Et.type="expression";var Xn=class{constructor(t,e){this.inputMaxValue=t,this.outputScale=e}map(t){return this.outputScale*vi(t/this.inputMaxValue)}},oo=new Set(["1.0","1.0-beta"]),Be=.01,ao=class{get name(){return"VRMLookAtLoaderPlugin"}constructor(t,e){this.parser=t,this.helperRoot=e==null?void 0:e.helperRoot}afterRoot(t){return L(this,null,function*(){const e=t.userData.vrmHumanoid;if(e===null)return;if(e===void 0)throw new Error("VRMLookAtLoaderPlugin: vrmHumanoid is undefined. VRMHumanoidLoaderPlugin have to be used first");const n=t.userData.vrmExpressionManager;if(n!==null){if(n===void 0)throw new Error("VRMLookAtLoaderPlugin: vrmExpressionManager is undefined. VRMExpressionLoaderPlugin have to be used first");t.userData.vrmLookAt=yield this._import(t,e,n)}})}_import(t,e,n){return L(this,null,function*(){if(e==null||n==null)return null;const i=yield this._v1Import(t,e,n);if(i)return i;const r=yield this._v0Import(t,e,n);return r||null})}_v1Import(t,e,n){return L(this,null,function*(){var i,r,s;const o=this.parser.json;if(!(((i=o.extensionsUsed)==null?void 0:i.indexOf("VRMC_vrm"))!==-1))return null;const a=(r=o.extensions)==null?void 0:r.VRMC_vrm;if(!a)return null;const u=a.specVersion;if(!oo.has(u))return console.warn(`VRMLookAtLoaderPlugin: Unknown VRMC_vrm specVersion "${u}"`),null;const c=a.lookAt;if(!c)return null;const d=c.type==="expression"?1:10,h=this._v1ImportRangeMap(c.rangeMapHorizontalInner,d),f=this._v1ImportRangeMap(c.rangeMapHorizontalOuter,d),p=this._v1ImportRangeMap(c.rangeMapVerticalDown,d),m=this._v1ImportRangeMap(c.rangeMapVerticalUp,d);let g;c.type==="expression"?g=new Et(n,h,f,p,m):g=new Ge(e,h,f,p,m);const _=this._importLookAt(e,g);return _.offsetFromHeadBone.fromArray((s=c.offsetFromHeadBone)!=null?s:[0,.06,0]),_})}_v1ImportRangeMap(t,e){var n,i;let r=(n=t==null?void 0:t.inputMaxValue)!=null?n:90;const s=(i=t==null?void 0:t.outputScale)!=null?i:e;return r<Be&&(console.warn("VRMLookAtLoaderPlugin: inputMaxValue of a range map is too small. Consider reviewing the range map!"),r=Be),new Xn(r,s)}_v0Import(t,e,n){return L(this,null,function*(){var i,r,s,o;const a=(i=this.parser.json.extensions)==null?void 0:i.VRM;if(!a)return null;const u=a.firstPerson;if(!u)return null;const c=u.lookAtTypeName==="BlendShape"?1:10,d=this._v0ImportDegreeMap(u.lookAtHorizontalInner,c),h=this._v0ImportDegreeMap(u.lookAtHorizontalOuter,c),f=this._v0ImportDegreeMap(u.lookAtVerticalDown,c),p=this._v0ImportDegreeMap(u.lookAtVerticalUp,c);let m;u.lookAtTypeName==="BlendShape"?m=new Et(n,d,h,f,p):m=new Ge(e,d,h,f,p);const g=this._importLookAt(e,m);return u.firstPersonBoneOffset?g.offsetFromHeadBone.set((r=u.firstPersonBoneOffset.x)!=null?r:0,(s=u.firstPersonBoneOffset.y)!=null?s:.06,-((o=u.firstPersonBoneOffset.z)!=null?o:0)):g.offsetFromHeadBone.set(0,.06,0),g.faceFront.set(0,0,-1),m instanceof Ge&&m.faceFront.set(0,0,-1),g})}_v0ImportDegreeMap(t,e){var n,i;const r=t==null?void 0:t.curve;JSON.stringify(r)!=="[0,0,0,1,1,1,1,0]"&&console.warn("Curves of LookAtDegreeMap defined in VRM 0.0 are not supported");let s=(n=t==null?void 0:t.xRange)!=null?n:90;const o=(i=t==null?void 0:t.yRange)!=null?i:e;return s<Be&&(console.warn("VRMLookAtLoaderPlugin: xRange of a degree map is too small. Consider reviewing the degree map!"),s=Be),new Xn(s,o)}_importLookAt(t,e){const n=new ro(t,e);if(this.helperRoot){const i=new Qs(n);this.helperRoot.add(i),i.renderOrder=this.helperRoot.renderOrder}return n}};function lo(t,e){return typeof t!="string"||t===""?"":(/^https?:\/\//i.test(e)&&/^\//.test(t)&&(e=e.replace(/(^https?:\/\/[^/]+).*/i,"$1")),/^(https?:)?\/\//i.test(t)||/^data:.*,.*$/i.test(t)||/^blob:.*$/i.test(t)?t:e+t)}var uo=new Set(["1.0","1.0-beta"]),co=class{get name(){return"VRMMetaLoaderPlugin"}constructor(t,e){var n,i,r;this.parser=t,this.needThumbnailImage=(n=e==null?void 0:e.needThumbnailImage)!=null?n:!1,this.acceptLicenseUrls=(i=e==null?void 0:e.acceptLicenseUrls)!=null?i:["https://vrm.dev/licenses/1.0/"],this.acceptV0Meta=(r=e==null?void 0:e.acceptV0Meta)!=null?r:!0}afterRoot(t){return L(this,null,function*(){t.userData.vrmMeta=yield this._import(t)})}_import(t){return L(this,null,function*(){const e=yield this._v1Import(t);if(e!=null)return e;const n=yield this._v0Import(t);return n??null})}_v1Import(t){return L(this,null,function*(){var e,n,i;const r=this.parser.json;if(!(((e=r.extensionsUsed)==null?void 0:e.indexOf("VRMC_vrm"))!==-1))return null;const o=(n=r.extensions)==null?void 0:n.VRMC_vrm;if(o==null)return null;const l=o.specVersion;if(!uo.has(l))return console.warn(`VRMMetaLoaderPlugin: Unknown VRMC_vrm specVersion "${l}"`),null;const a=o.meta;if(!a)return null;const u=a.licenseUrl;if(!new Set(this.acceptLicenseUrls).has(u))throw new Error(`VRMMetaLoaderPlugin: The license url "${u}" is not accepted`);let d;return this.needThumbnailImage&&a.thumbnailImage!=null&&(d=(i=yield this._extractGLTFImage(a.thumbnailImage))!=null?i:void 0),{metaVersion:"1",name:a.name,version:a.version,authors:a.authors,copyrightInformation:a.copyrightInformation,contactInformation:a.contactInformation,references:a.references,thirdPartyLicenses:a.thirdPartyLicenses,thumbnailImage:d,licenseUrl:a.licenseUrl,avatarPermission:a.avatarPermission,allowExcessivelyViolentUsage:a.allowExcessivelyViolentUsage,allowExcessivelySexualUsage:a.allowExcessivelySexualUsage,commercialUsage:a.commercialUsage,allowPoliticalOrReligiousUsage:a.allowPoliticalOrReligiousUsage,allowAntisocialOrHateUsage:a.allowAntisocialOrHateUsage,creditNotation:a.creditNotation,allowRedistribution:a.allowRedistribution,modification:a.modification,otherLicenseUrl:a.otherLicenseUrl}})}_v0Import(t){return L(this,null,function*(){var e;const i=(e=this.parser.json.extensions)==null?void 0:e.VRM;if(!i)return null;const r=i.meta;if(!r)return null;if(!this.acceptV0Meta)throw new Error("VRMMetaLoaderPlugin: Attempted to load VRM0.0 meta but acceptV0Meta is false");let s;return this.needThumbnailImage&&r.texture!=null&&r.texture!==-1&&(s=yield this.parser.getDependency("texture",r.texture)),{metaVersion:"0",allowedUserName:r.allowedUserName,author:r.author,commercialUssageName:r.commercialUssageName,contactInformation:r.contactInformation,licenseName:r.licenseName,otherLicenseUrl:r.otherLicenseUrl,otherPermissionUrl:r.otherPermissionUrl,reference:r.reference,sexualUssageName:r.sexualUssageName,texture:s??void 0,title:r.title,version:r.version,violentUssageName:r.violentUssageName}})}_extractGLTFImage(t){return L(this,null,function*(){var e;const i=(e=this.parser.json.images)==null?void 0:e[t];if(i==null)return console.warn(`VRMMetaLoaderPlugin: Attempt to use images[${t}] of glTF as a thumbnail but the image doesn't exist`),null;let r=i.uri;if(i.bufferView!=null){const o=yield this.parser.getDependency("bufferView",i.bufferView),l=new Blob([o],{type:i.mimeType});r=URL.createObjectURL(l)}return r==null?(console.warn(`VRMMetaLoaderPlugin: Attempt to use images[${t}] of glTF as a thumbnail but the image couldn't load properly`),null):yield new jr().loadAsync(lo(r,this.parser.options.path)).catch(o=>(console.error(o),console.warn("VRMMetaLoaderPlugin: Failed to load a thumbnail image"),null))})}},ho=class{constructor(t){this.scene=t.scene,this.meta=t.meta,this.humanoid=t.humanoid,this.expressionManager=t.expressionManager,this.firstPerson=t.firstPerson,this.lookAt=t.lookAt}update(t){this.humanoid.update(),this.lookAt&&this.lookAt.update(t),this.expressionManager&&this.expressionManager.update()}},fo=class extends ho{constructor(t){super(t),this.materials=t.materials,this.springBoneManager=t.springBoneManager,this.nodeConstraintManager=t.nodeConstraintManager}update(t){super.update(t),this.nodeConstraintManager&&this.nodeConstraintManager.update(),this.springBoneManager&&this.springBoneManager.update(t),this.materials&&this.materials.forEach(e=>{e.update&&e.update(t)})}},po=Object.defineProperty,qn=Object.getOwnPropertySymbols,mo=Object.prototype.hasOwnProperty,go=Object.prototype.propertyIsEnumerable,Yn=(t,e,n)=>e in t?po(t,e,{enumerable:!0,configurable:!0,writable:!0,value:n}):t[e]=n,Kn=(t,e)=>{for(var n in e||(e={}))mo.call(e,n)&&Yn(t,n,e[n]);if(qn)for(var n of qn(e))go.call(e,n)&&Yn(t,n,e[n]);return t},ce=(t,e,n)=>new Promise((i,r)=>{var s=a=>{try{l(n.next(a))}catch(u){r(u)}},o=a=>{try{l(n.throw(a))}catch(u){r(u)}},l=a=>a.done?i(a.value):Promise.resolve(a.value).then(s,o);l((n=n.apply(t,e)).next())}),_o={"":3e3,srgb:3001};function vo(t,e){parseInt(Xe,10)>=152?t.colorSpace=e:t.encoding=_o[e]}var Mo=class{get pending(){return Promise.all(this._pendings)}constructor(t,e){this._parser=t,this._materialParams=e,this._pendings=[]}assignPrimitive(t,e){e!=null&&(this._materialParams[t]=e)}assignColor(t,e,n){if(e!=null){const i=new O().fromArray(e);n&&i.convertSRGBToLinear(),this._materialParams[t]=i}}assignTexture(t,e,n){return ce(this,null,function*(){const i=ce(this,null,function*(){e!=null&&(yield this._parser.assignTexture(this._materialParams,t,e),n&&vo(this._materialParams[t],"srgb"))});return this._pendings.push(i),i})}assignTextureByIndex(t,e,n){return ce(this,null,function*(){return this.assignTexture(t,e!=null?{index:e}:void 0,n)})}},To=`// #define PHONG

varying vec3 vViewPosition;

#ifndef FLAT_SHADED
  varying vec3 vNormal;
#endif

#include <common>

// #include <uv_pars_vertex>
#ifdef MTOON_USE_UV
  varying vec2 vUv;

  // COMPAT: pre-r151 uses a common uvTransform
  #if THREE_VRM_THREE_REVISION < 151
    uniform mat3 uvTransform;
  #endif
#endif

// #include <uv2_pars_vertex>
// COMAPT: pre-r151 uses uv2 for lightMap and aoMap
#if THREE_VRM_THREE_REVISION < 151
  #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
    attribute vec2 uv2;
    varying vec2 vUv2;
    uniform mat3 uv2Transform;
  #endif
#endif

// #include <displacementmap_pars_vertex>
// #include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

#ifdef USE_OUTLINEWIDTHMULTIPLYTEXTURE
  uniform sampler2D outlineWidthMultiplyTexture;
  uniform mat3 outlineWidthMultiplyTextureUvTransform;
#endif

uniform float outlineWidthFactor;

void main() {

  // #include <uv_vertex>
  #ifdef MTOON_USE_UV
    // COMPAT: pre-r151 uses a common uvTransform
    #if THREE_VRM_THREE_REVISION >= 151
      vUv = uv;
    #else
      vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
    #endif
  #endif

  // #include <uv2_vertex>
  // COMAPT: pre-r151 uses uv2 for lightMap and aoMap
  #if THREE_VRM_THREE_REVISION < 151
    #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
      vUv2 = ( uv2Transform * vec3( uv2, 1 ) ).xy;
    #endif
  #endif

  #include <color_vertex>

  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>

  // we need this to compute the outline properly
  objectNormal = normalize( objectNormal );

  #include <defaultnormal_vertex>

  #ifndef FLAT_SHADED // Normal computed with derivatives when FLAT_SHADED
    vNormal = normalize( transformedNormal );
  #endif

  #include <begin_vertex>

  #include <morphtarget_vertex>
  #include <skinning_vertex>
  // #include <displacementmap_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  vViewPosition = - mvPosition.xyz;

  #ifdef OUTLINE
    float worldNormalLength = length( transformedNormal );
    vec3 outlineOffset = outlineWidthFactor * worldNormalLength * objectNormal;

    #ifdef USE_OUTLINEWIDTHMULTIPLYTEXTURE
      vec2 outlineWidthMultiplyTextureUv = ( outlineWidthMultiplyTextureUvTransform * vec3( vUv, 1 ) ).xy;
      float outlineTex = texture2D( outlineWidthMultiplyTexture, outlineWidthMultiplyTextureUv ).g;
      outlineOffset *= outlineTex;
    #endif

    #ifdef OUTLINE_WIDTH_SCREEN
      outlineOffset *= vViewPosition.z / projectionMatrix[ 1 ].y;
    #endif

    gl_Position = projectionMatrix * modelViewMatrix * vec4( outlineOffset + transformed, 1.0 );

    gl_Position.z += 1E-6 * gl_Position.w; // anti-artifact magic
  #endif

  #include <worldpos_vertex>
  // #include <envmap_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>

}`,xo=`// #define PHONG

uniform vec3 litFactor;

uniform float opacity;

uniform vec3 shadeColorFactor;
#ifdef USE_SHADEMULTIPLYTEXTURE
  uniform sampler2D shadeMultiplyTexture;
  uniform mat3 shadeMultiplyTextureUvTransform;
#endif

uniform float shadingShiftFactor;
uniform float shadingToonyFactor;

#ifdef USE_SHADINGSHIFTTEXTURE
  uniform sampler2D shadingShiftTexture;
  uniform mat3 shadingShiftTextureUvTransform;
  uniform float shadingShiftTextureScale;
#endif

uniform float giEqualizationFactor;

uniform vec3 parametricRimColorFactor;
#ifdef USE_RIMMULTIPLYTEXTURE
  uniform sampler2D rimMultiplyTexture;
  uniform mat3 rimMultiplyTextureUvTransform;
#endif
uniform float rimLightingMixFactor;
uniform float parametricRimFresnelPowerFactor;
uniform float parametricRimLiftFactor;

#ifdef USE_MATCAPTEXTURE
  uniform vec3 matcapFactor;
  uniform sampler2D matcapTexture;
  uniform mat3 matcapTextureUvTransform;
#endif

uniform vec3 emissive;
uniform float emissiveIntensity;

uniform vec3 outlineColorFactor;
uniform float outlineLightingMixFactor;

#ifdef USE_UVANIMATIONMASKTEXTURE
  uniform sampler2D uvAnimationMaskTexture;
  uniform mat3 uvAnimationMaskTextureUvTransform;
#endif

uniform float uvAnimationScrollXOffset;
uniform float uvAnimationScrollYOffset;
uniform float uvAnimationRotationPhase;

#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>

// #include <uv_pars_fragment>
#if ( defined( MTOON_USE_UV ) && !defined( MTOON_UVS_VERTEX_ONLY ) )
  varying vec2 vUv;
#endif

// #include <uv2_pars_fragment>
// COMAPT: pre-r151 uses uv2 for lightMap and aoMap
#if THREE_VRM_THREE_REVISION < 151
  #if defined( USE_LIGHTMAP ) || defined( USE_AOMAP )
    varying vec2 vUv2;
  #endif
#endif

#include <map_pars_fragment>

#ifdef USE_MAP
  uniform mat3 mapUvTransform;
#endif

// #include <alphamap_pars_fragment>

#include <alphatest_pars_fragment>

#include <aomap_pars_fragment>
// #include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>

#ifdef USE_EMISSIVEMAP
  uniform mat3 emissiveMapUvTransform;
#endif

// #include <envmap_common_pars_fragment>
// #include <envmap_pars_fragment>
// #include <cube_uv_reflection_fragment>
#include <fog_pars_fragment>

// #include <bsdfs>
// COMPAT: pre-r151 doesn't have BRDF_Lambert in <common>
#if THREE_VRM_THREE_REVISION < 151
  vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
    return RECIPROCAL_PI * diffuseColor;
  }
#endif

#include <lights_pars_begin>

#include <normal_pars_fragment>

// #include <lights_phong_pars_fragment>
varying vec3 vViewPosition;

struct MToonMaterial {
  vec3 diffuseColor;
  vec3 shadeColor;
  float shadingShift;
};

float linearstep( float a, float b, float t ) {
  return clamp( ( t - a ) / ( b - a ), 0.0, 1.0 );
}

/**
 * Convert NdotL into toon shading factor using shadingShift and shadingToony
 */
float getShading(
  const in float dotNL,
  const in float shadow,
  const in float shadingShift
) {
  float shading = dotNL;
  shading = shading + shadingShift;
  shading = linearstep( -1.0 + shadingToonyFactor, 1.0 - shadingToonyFactor, shading );
  shading *= shadow;
  return shading;
}

/**
 * Mix diffuseColor and shadeColor using shading factor and light color
 */
vec3 getDiffuse(
  const in MToonMaterial material,
  const in float shading,
  in vec3 lightColor
) {
  #ifdef DEBUG_LITSHADERATE
    return vec3( BRDF_Lambert( shading * lightColor ) );
  #endif

  vec3 col = lightColor * BRDF_Lambert( mix( material.shadeColor, material.diffuseColor, shading ) );

  // The "comment out if you want to PBR absolutely" line
  #ifdef V0_COMPAT_SHADE
    col = min( col, material.diffuseColor );
  #endif

  return col;
}

// COMPAT: pre-r156 uses a struct GeometricContext
#if THREE_VRM_THREE_REVISION >= 157
  void RE_Direct_MToon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in MToonMaterial material, const in float shadow, inout ReflectedLight reflectedLight ) {
    float dotNL = clamp( dot( geometryNormal, directLight.direction ), -1.0, 1.0 );
    vec3 irradiance = directLight.color;

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;

    irradiance *= dotNL;

    float shading = getShading( dotNL, shadow, material.shadingShift );

    // toon shaded diffuse
    reflectedLight.directDiffuse += getDiffuse( material, shading, directLight.color );
  }

  void RE_IndirectDiffuse_MToon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in MToonMaterial material, inout ReflectedLight reflectedLight ) {
    // indirect diffuse will use diffuseColor, no shadeColor involved
    reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;
  }
#else
  void RE_Direct_MToon( const in IncidentLight directLight, const in GeometricContext geometry, const in MToonMaterial material, const in float shadow, inout ReflectedLight reflectedLight ) {
    float dotNL = clamp( dot( geometry.normal, directLight.direction ), -1.0, 1.0 );
    vec3 irradiance = directLight.color;

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;

    irradiance *= dotNL;

    float shading = getShading( dotNL, shadow, material.shadingShift );

    // toon shaded diffuse
    reflectedLight.directDiffuse += getDiffuse( material, shading, directLight.color );
  }

  void RE_IndirectDiffuse_MToon( const in vec3 irradiance, const in GeometricContext geometry, const in MToonMaterial material, inout ReflectedLight reflectedLight ) {
    // indirect diffuse will use diffuseColor, no shadeColor involved
    reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );

    // directSpecular will be used for rim lighting, not an actual specular
    reflectedLight.directSpecular += irradiance;
  }
#endif

#define RE_Direct RE_Direct_MToon
#define RE_IndirectDiffuse RE_IndirectDiffuse_MToon
#define Material_LightProbeLOD( material ) (0)

#include <shadowmap_pars_fragment>
// #include <bumpmap_pars_fragment>

// #include <normalmap_pars_fragment>
#ifdef USE_NORMALMAP

  uniform sampler2D normalMap;
  uniform mat3 normalMapUvTransform;
  uniform vec2 normalScale;

#endif

// COMPAT: pre-r151
// USE_NORMALMAP_OBJECTSPACE used to be OBJECTSPACE_NORMALMAP in pre-r151
#if defined( USE_NORMALMAP_OBJECTSPACE ) || defined( OBJECTSPACE_NORMALMAP )

  uniform mat3 normalMatrix;

#endif

// COMPAT: pre-r151
// USE_NORMALMAP_TANGENTSPACE used to be TANGENTSPACE_NORMALMAP in pre-r151
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( TANGENTSPACE_NORMALMAP ) )

  // Per-Pixel Tangent Space Normal Mapping
  // http://hacksoflife.blogspot.ch/2009/11/per-pixel-tangent-space-normal-mapping.html

  // three-vrm specific change: it requires \`uv\` as an input in order to support uv scrolls

  // Temporary compat against shader change @ Three.js r126, r151
  #if THREE_VRM_THREE_REVISION >= 151

    mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {

      vec3 q0 = dFdx( eye_pos.xyz );
      vec3 q1 = dFdy( eye_pos.xyz );
      vec2 st0 = dFdx( uv.st );
      vec2 st1 = dFdy( uv.st );

      vec3 N = surf_norm;

      vec3 q1perp = cross( q1, N );
      vec3 q0perp = cross( N, q0 );

      vec3 T = q1perp * st0.x + q0perp * st1.x;
      vec3 B = q1perp * st0.y + q0perp * st1.y;

      float det = max( dot( T, T ), dot( B, B ) );
      float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );

      return mat3( T * scale, B * scale, N );

    }

  #else

    vec3 perturbNormal2Arb( vec2 uv, vec3 eye_pos, vec3 surf_norm, vec3 mapN, float faceDirection ) {

      vec3 q0 = vec3( dFdx( eye_pos.x ), dFdx( eye_pos.y ), dFdx( eye_pos.z ) );
      vec3 q1 = vec3( dFdy( eye_pos.x ), dFdy( eye_pos.y ), dFdy( eye_pos.z ) );
      vec2 st0 = dFdx( uv.st );
      vec2 st1 = dFdy( uv.st );

      vec3 N = normalize( surf_norm );

      vec3 q1perp = cross( q1, N );
      vec3 q0perp = cross( N, q0 );

      vec3 T = q1perp * st0.x + q0perp * st1.x;
      vec3 B = q1perp * st0.y + q0perp * st1.y;

      // three-vrm specific change: Workaround for the issue that happens when delta of uv = 0.0
      // TODO: Is this still required? Or shall I make a PR about it?
      if ( length( T ) == 0.0 || length( B ) == 0.0 ) {
        return surf_norm;
      }

      float det = max( dot( T, T ), dot( B, B ) );
      float scale = ( det == 0.0 ) ? 0.0 : faceDirection * inversesqrt( det );

      return normalize( T * ( mapN.x * scale ) + B * ( mapN.y * scale ) + N * mapN.z );

    }

  #endif

#endif

// #include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

// == post correction ==========================================================
void postCorrection() {
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #include <premultiplied_alpha_fragment>
  #include <dithering_fragment>
}

// == main procedure ===========================================================
void main() {
  #include <clipping_planes_fragment>

  vec2 uv = vec2(0.5, 0.5);

  #if ( defined( MTOON_USE_UV ) && !defined( MTOON_UVS_VERTEX_ONLY ) )
    uv = vUv;

    float uvAnimMask = 1.0;
    #ifdef USE_UVANIMATIONMASKTEXTURE
      vec2 uvAnimationMaskTextureUv = ( uvAnimationMaskTextureUvTransform * vec3( uv, 1 ) ).xy;
      uvAnimMask = texture2D( uvAnimationMaskTexture, uvAnimationMaskTextureUv ).b;
    #endif

    float uvRotCos = cos( uvAnimationRotationPhase * uvAnimMask );
    float uvRotSin = sin( uvAnimationRotationPhase * uvAnimMask );
    uv = mat2( uvRotCos, -uvRotSin, uvRotSin, uvRotCos ) * ( uv - 0.5 ) + 0.5;
    uv = uv + vec2( uvAnimationScrollXOffset, uvAnimationScrollYOffset ) * uvAnimMask;
  #endif

  #ifdef DEBUG_UV
    gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
    #if ( defined( MTOON_USE_UV ) && !defined( MTOON_UVS_VERTEX_ONLY ) )
      gl_FragColor = vec4( uv, 0.0, 1.0 );
    #endif
    return;
  #endif

  vec4 diffuseColor = vec4( litFactor, opacity );
  ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  vec3 totalEmissiveRadiance = emissive * emissiveIntensity;

  #include <logdepthbuf_fragment>

  // #include <map_fragment>
  #ifdef USE_MAP
    vec2 mapUv = ( mapUvTransform * vec3( uv, 1 ) ).xy;
    vec4 sampledDiffuseColor = texture2D( map, mapUv );
    #ifdef DECODE_VIDEO_TEXTURE
      sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
    #endif
    diffuseColor *= sampledDiffuseColor;
  #endif

  // #include <color_fragment>
  #if ( defined( USE_COLOR ) && !defined( IGNORE_VERTEX_COLOR ) )
    diffuseColor.rgb *= vColor;
  #endif

  // #include <alphamap_fragment>

  #include <alphatest_fragment>

  // #include <specularmap_fragment>

  // #include <normal_fragment_begin>
  float faceDirection = gl_FrontFacing ? 1.0 : -1.0;

  #ifdef FLAT_SHADED

    vec3 fdx = dFdx( vViewPosition );
    vec3 fdy = dFdy( vViewPosition );
    vec3 normal = normalize( cross( fdx, fdy ) );

  #else

    vec3 normal = normalize( vNormal );

    #ifdef DOUBLE_SIDED

      normal *= faceDirection;

    #endif

  #endif

  #ifdef USE_NORMALMAP

    vec2 normalMapUv = ( normalMapUvTransform * vec3( uv, 1 ) ).xy;

  #endif

  #ifdef USE_NORMALMAP_TANGENTSPACE

    #ifdef USE_TANGENT

      mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );

    #else

      mat3 tbn = getTangentFrame( - vViewPosition, normal, normalMapUv );

    #endif

    #if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )

      tbn[0] *= faceDirection;
      tbn[1] *= faceDirection;

    #endif

  #endif

  #ifdef USE_CLEARCOAT_NORMALMAP

    #ifdef USE_TANGENT

      mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );

    #else

      mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );

    #endif

    #if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )

      tbn2[0] *= faceDirection;
      tbn2[1] *= faceDirection;

    #endif

  #endif

  // non perturbed normal for clearcoat among others

  vec3 nonPerturbedNormal = normal;

  #ifdef OUTLINE
    normal *= -1.0;
  #endif

  // #include <normal_fragment_maps>

  // COMPAT: pre-r151
  // USE_NORMALMAP_OBJECTSPACE used to be OBJECTSPACE_NORMALMAP in pre-r151
  #if defined( USE_NORMALMAP_OBJECTSPACE ) || defined( OBJECTSPACE_NORMALMAP )

    normal = texture2D( normalMap, normalMapUv ).xyz * 2.0 - 1.0; // overrides both flatShading and attribute normals

    #ifdef FLIP_SIDED

      normal = - normal;

    #endif

    #ifdef DOUBLE_SIDED

      normal = normal * faceDirection;

    #endif

    normal = normalize( normalMatrix * normal );

  // COMPAT: pre-r151
  // USE_NORMALMAP_TANGENTSPACE used to be TANGENTSPACE_NORMALMAP in pre-r151
  #elif defined( USE_NORMALMAP_TANGENTSPACE ) || defined( TANGENTSPACE_NORMALMAP )

    vec3 mapN = texture2D( normalMap, normalMapUv ).xyz * 2.0 - 1.0;
    mapN.xy *= normalScale;

    // COMPAT: pre-r151
    #if THREE_VRM_THREE_REVISION >= 151 || defined( USE_TANGENT )

      normal = normalize( tbn * mapN );

    #else

      normal = perturbNormal2Arb( uv, -vViewPosition, normal, mapN, faceDirection );

    #endif

  #endif

  // #include <emissivemap_fragment>
  #ifdef USE_EMISSIVEMAP
    vec2 emissiveMapUv = ( emissiveMapUvTransform * vec3( uv, 1 ) ).xy;
    totalEmissiveRadiance *= texture2D( emissiveMap, emissiveMapUv ).rgb;
  #endif

  #ifdef DEBUG_NORMAL
    gl_FragColor = vec4( 0.5 + 0.5 * normal, 1.0 );
    return;
  #endif

  // -- MToon: lighting --------------------------------------------------------
  // accumulation
  // #include <lights_phong_fragment>
  MToonMaterial material;

  material.diffuseColor = diffuseColor.rgb;

  material.shadeColor = shadeColorFactor;
  #ifdef USE_SHADEMULTIPLYTEXTURE
    vec2 shadeMultiplyTextureUv = ( shadeMultiplyTextureUvTransform * vec3( uv, 1 ) ).xy;
    material.shadeColor *= texture2D( shadeMultiplyTexture, shadeMultiplyTextureUv ).rgb;
  #endif

  #if ( defined( USE_COLOR ) && !defined( IGNORE_VERTEX_COLOR ) )
    material.shadeColor.rgb *= vColor;
  #endif

  material.shadingShift = shadingShiftFactor;
  #ifdef USE_SHADINGSHIFTTEXTURE
    vec2 shadingShiftTextureUv = ( shadingShiftTextureUvTransform * vec3( uv, 1 ) ).xy;
    material.shadingShift += texture2D( shadingShiftTexture, shadingShiftTextureUv ).r * shadingShiftTextureScale;
  #endif

  // #include <lights_fragment_begin>

  // MToon Specific changes:
  // Since we want to take shadows into account of shading instead of irradiance,
  // we had to modify the codes that multiplies the results of shadowmap into color of direct lights.

  // COMPAT: pre-r156 uses a struct GeometricContext
  #if THREE_VRM_THREE_REVISION >= 157
    vec3 geometryPosition = - vViewPosition;
    vec3 geometryNormal = normal;
    vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );

    vec3 geometryClearcoatNormal;

    #ifdef USE_CLEARCOAT

      geometryClearcoatNormal = clearcoatNormal;

    #endif
  #else
    GeometricContext geometry;

    geometry.position = - vViewPosition;
    geometry.normal = normal;
    geometry.viewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );

    #ifdef USE_CLEARCOAT

      geometry.clearcoatNormal = clearcoatNormal;

    #endif
  #endif

  IncidentLight directLight;

  // since these variables will be used in unrolled loop, we have to define in prior
  float shadow;

  #if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )

    PointLight pointLight;
    #if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
    PointLightShadow pointLightShadow;
    #endif

    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {

      pointLight = pointLights[ i ];

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        getPointLightInfo( pointLight, geometryPosition, directLight );
      #else
        getPointLightInfo( pointLight, geometry, directLight );
      #endif

      shadow = 1.0;
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
      pointLightShadow = pointLightShadows[ i ];
      // COMPAT: pre-r166
      // r166 introduced shadowIntensity
      #if THREE_VRM_THREE_REVISION >= 166
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
      #else
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
      #endif
      #endif

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, shadow, reflectedLight );
      #else
        RE_Direct( directLight, geometry, material, shadow, reflectedLight );
      #endif

    }
    #pragma unroll_loop_end

  #endif

  #if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )

    SpotLight spotLight;
    // COMPAT: pre-r144 uses NUM_SPOT_LIGHT_SHADOWS, r144+ uses NUM_SPOT_LIGHT_COORDS
    #if THREE_VRM_THREE_REVISION >= 144
      #if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_COORDS > 0
      SpotLightShadow spotLightShadow;
      #endif
    #elif defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
    SpotLightShadow spotLightShadow;
    #endif

    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {

      spotLight = spotLights[ i ];

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        getSpotLightInfo( spotLight, geometryPosition, directLight );
      #else
        getSpotLightInfo( spotLight, geometry, directLight );
      #endif

      shadow = 1.0;
      // COMPAT: pre-r144 uses NUM_SPOT_LIGHT_SHADOWS and vSpotShadowCoord, r144+ uses NUM_SPOT_LIGHT_COORDS and vSpotLightCoord
      // COMPAT: pre-r166 does not have shadowIntensity, r166+ has shadowIntensity
      #if THREE_VRM_THREE_REVISION >= 166
        #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_COORDS )
        spotLightShadow = spotLightShadows[ i ];
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
        #endif
      #elif THREE_VRM_THREE_REVISION >= 144
        #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_COORDS )
        spotLightShadow = spotLightShadows[ i ];
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
        #endif
      #elif defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
      spotLightShadow = spotLightShadows[ i ];
      shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotShadowCoord[ i ] ) : 1.0;
      #endif

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, shadow, reflectedLight );
      #else
        RE_Direct( directLight, geometry, material, shadow, reflectedLight );
      #endif

    }
    #pragma unroll_loop_end

  #endif

  #if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )

    DirectionalLight directionalLight;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow directionalLightShadow;
    #endif

    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

      directionalLight = directionalLights[ i ];

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        getDirectionalLightInfo( directionalLight, directLight );
      #else
        getDirectionalLightInfo( directionalLight, geometry, directLight );
      #endif

      shadow = 1.0;
      #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
      directionalLightShadow = directionalLightShadows[ i ];
      // COMPAT: pre-r166
      // r166 introduced shadowIntensity
      #if THREE_VRM_THREE_REVISION >= 166
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
      #else
        shadow = all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
      #endif
      #endif

      // COMPAT: pre-r156 uses a struct GeometricContext
      #if THREE_VRM_THREE_REVISION >= 157
        RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, shadow, reflectedLight );
      #else
        RE_Direct( directLight, geometry, material, shadow, reflectedLight );
      #endif

    }
    #pragma unroll_loop_end

  #endif

  // #if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )

  //   RectAreaLight rectAreaLight;

  //   #pragma unroll_loop_start
  //   for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {

  //     rectAreaLight = rectAreaLights[ i ];
  //     RE_Direct_RectArea( rectAreaLight, geometry, material, reflectedLight );

  //   }
  //   #pragma unroll_loop_end

  // #endif

  #if defined( RE_IndirectDiffuse )

    vec3 iblIrradiance = vec3( 0.0 );

    vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );

    // COMPAT: pre-r156 uses a struct GeometricContext
    // COMPAT: pre-r156 doesn't have a define USE_LIGHT_PROBES
    #if THREE_VRM_THREE_REVISION >= 157
      #if defined( USE_LIGHT_PROBES )
        irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
      #endif
    #else
      irradiance += getLightProbeIrradiance( lightProbe, geometry.normal );
    #endif

    #if ( NUM_HEMI_LIGHTS > 0 )

      #pragma unroll_loop_start
      for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {

        // COMPAT: pre-r156 uses a struct GeometricContext
        #if THREE_VRM_THREE_REVISION >= 157
          irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
        #else
          irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometry.normal );
        #endif

      }
      #pragma unroll_loop_end

    #endif

  #endif

  // #if defined( RE_IndirectSpecular )

  //   vec3 radiance = vec3( 0.0 );
  //   vec3 clearcoatRadiance = vec3( 0.0 );

  // #endif

  #include <lights_fragment_maps>
  #include <lights_fragment_end>

  // modulation
  #include <aomap_fragment>

  vec3 col = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;

  #ifdef DEBUG_LITSHADERATE
    gl_FragColor = vec4( col, diffuseColor.a );
    postCorrection();
    return;
  #endif

  // -- MToon: rim lighting -----------------------------------------
  vec3 viewDir = normalize( vViewPosition );

  #ifndef PHYSICALLY_CORRECT_LIGHTS
    reflectedLight.directSpecular /= PI;
  #endif
  vec3 rimMix = mix( vec3( 1.0 ), reflectedLight.directSpecular, rimLightingMixFactor );

  vec3 rim = parametricRimColorFactor * pow( saturate( 1.0 - dot( viewDir, normal ) + parametricRimLiftFactor ), parametricRimFresnelPowerFactor );

  #ifdef USE_MATCAPTEXTURE
    {
      vec3 x = normalize( vec3( viewDir.z, 0.0, -viewDir.x ) );
      vec3 y = cross( viewDir, x ); // guaranteed to be normalized
      vec2 sphereUv = 0.5 + 0.5 * vec2( dot( x, normal ), -dot( y, normal ) );
      sphereUv = ( matcapTextureUvTransform * vec3( sphereUv, 1 ) ).xy;
      vec3 matcap = texture2D( matcapTexture, sphereUv ).rgb;
      rim += matcapFactor * matcap;
    }
  #endif

  #ifdef USE_RIMMULTIPLYTEXTURE
    vec2 rimMultiplyTextureUv = ( rimMultiplyTextureUvTransform * vec3( uv, 1 ) ).xy;
    rim *= texture2D( rimMultiplyTexture, rimMultiplyTextureUv ).rgb;
  #endif

  col += rimMix * rim;

  // -- MToon: Emission --------------------------------------------------------
  col += totalEmissiveRadiance;

  // #include <envmap_fragment>

  // -- Almost done! -----------------------------------------------------------
  #if defined( OUTLINE )
    col = outlineColorFactor.rgb * mix( vec3( 1.0 ), col, outlineLightingMixFactor );
  #endif

  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif

  gl_FragColor = vec4( col, diffuseColor.a );
  postCorrection();
}
`,yo={None:"none"},Qn={None:"none",ScreenCoordinates:"screenCoordinates"},Ro={3e3:"",3001:"srgb"};function lt(t){return parseInt(Xe,10)>=152?t.colorSpace:Ro[t.encoding]}var wo=class extends Xr{constructor(t={}){var e;super({vertexShader:To,fragmentShader:xo}),this.uvAnimationScrollXSpeedFactor=0,this.uvAnimationScrollYSpeedFactor=0,this.uvAnimationRotationSpeedFactor=0,this.fog=!0,this.normalMapType=qr,this._ignoreVertexColor=!0,this._v0CompatShade=!1,this._debugMode=yo.None,this._outlineWidthMode=Qn.None,this._isOutline=!1,t.transparentWithZWrite&&(t.depthWrite=!0),delete t.transparentWithZWrite,t.fog=!0,t.lights=!0,t.clipping=!0,this.uniforms=Yr.merge([Re.common,Re.normalmap,Re.emissivemap,Re.fog,Re.lights,{litFactor:{value:new O(1,1,1)},mapUvTransform:{value:new j},colorAlpha:{value:1},normalMapUvTransform:{value:new j},shadeColorFactor:{value:new O(0,0,0)},shadeMultiplyTexture:{value:null},shadeMultiplyTextureUvTransform:{value:new j},shadingShiftFactor:{value:0},shadingShiftTexture:{value:null},shadingShiftTextureUvTransform:{value:new j},shadingShiftTextureScale:{value:1},shadingToonyFactor:{value:.9},giEqualizationFactor:{value:.9},matcapFactor:{value:new O(1,1,1)},matcapTexture:{value:null},matcapTextureUvTransform:{value:new j},parametricRimColorFactor:{value:new O(0,0,0)},rimMultiplyTexture:{value:null},rimMultiplyTextureUvTransform:{value:new j},rimLightingMixFactor:{value:1},parametricRimFresnelPowerFactor:{value:5},parametricRimLiftFactor:{value:0},emissive:{value:new O(0,0,0)},emissiveIntensity:{value:1},emissiveMapUvTransform:{value:new j},outlineWidthMultiplyTexture:{value:null},outlineWidthMultiplyTextureUvTransform:{value:new j},outlineWidthFactor:{value:0},outlineColorFactor:{value:new O(0,0,0)},outlineLightingMixFactor:{value:1},uvAnimationMaskTexture:{value:null},uvAnimationMaskTextureUvTransform:{value:new j},uvAnimationScrollXOffset:{value:0},uvAnimationScrollYOffset:{value:0},uvAnimationRotationPhase:{value:0}},(e=t.uniforms)!=null?e:{}]),this.setValues(t),this._uploadUniformsWorkaround(),this.customProgramCacheKey=()=>[...Object.entries(this._generateDefines()).map(([n,i])=>`${n}:${i}`),this.matcapTexture?`matcapTextureColorSpace:${lt(this.matcapTexture)}`:"",this.shadeMultiplyTexture?`shadeMultiplyTextureColorSpace:${lt(this.shadeMultiplyTexture)}`:"",this.rimMultiplyTexture?`rimMultiplyTextureColorSpace:${lt(this.rimMultiplyTexture)}`:""].join(","),this.onBeforeCompile=n=>{const i=parseInt(Xe,10),r=Object.entries(Kn(Kn({},this._generateDefines()),this.defines)).filter(([s,o])=>!!o).map(([s,o])=>`#define ${s} ${o}`).join(`
`)+`
`;n.vertexShader=r+n.vertexShader,n.fragmentShader=r+n.fragmentShader,i<154&&(n.fragmentShader=n.fragmentShader.replace("#include <colorspace_fragment>","#include <encodings_fragment>"))}}get color(){return this.uniforms.litFactor.value}set color(t){this.uniforms.litFactor.value=t}get map(){return this.uniforms.map.value}set map(t){this.uniforms.map.value=t}get normalMap(){return this.uniforms.normalMap.value}set normalMap(t){this.uniforms.normalMap.value=t}get normalScale(){return this.uniforms.normalScale.value}set normalScale(t){this.uniforms.normalScale.value=t}get emissive(){return this.uniforms.emissive.value}set emissive(t){this.uniforms.emissive.value=t}get emissiveIntensity(){return this.uniforms.emissiveIntensity.value}set emissiveIntensity(t){this.uniforms.emissiveIntensity.value=t}get emissiveMap(){return this.uniforms.emissiveMap.value}set emissiveMap(t){this.uniforms.emissiveMap.value=t}get shadeColorFactor(){return this.uniforms.shadeColorFactor.value}set shadeColorFactor(t){this.uniforms.shadeColorFactor.value=t}get shadeMultiplyTexture(){return this.uniforms.shadeMultiplyTexture.value}set shadeMultiplyTexture(t){this.uniforms.shadeMultiplyTexture.value=t}get shadingShiftFactor(){return this.uniforms.shadingShiftFactor.value}set shadingShiftFactor(t){this.uniforms.shadingShiftFactor.value=t}get shadingShiftTexture(){return this.uniforms.shadingShiftTexture.value}set shadingShiftTexture(t){this.uniforms.shadingShiftTexture.value=t}get shadingShiftTextureScale(){return this.uniforms.shadingShiftTextureScale.value}set shadingShiftTextureScale(t){this.uniforms.shadingShiftTextureScale.value=t}get shadingToonyFactor(){return this.uniforms.shadingToonyFactor.value}set shadingToonyFactor(t){this.uniforms.shadingToonyFactor.value=t}get giEqualizationFactor(){return this.uniforms.giEqualizationFactor.value}set giEqualizationFactor(t){this.uniforms.giEqualizationFactor.value=t}get matcapFactor(){return this.uniforms.matcapFactor.value}set matcapFactor(t){this.uniforms.matcapFactor.value=t}get matcapTexture(){return this.uniforms.matcapTexture.value}set matcapTexture(t){this.uniforms.matcapTexture.value=t}get parametricRimColorFactor(){return this.uniforms.parametricRimColorFactor.value}set parametricRimColorFactor(t){this.uniforms.parametricRimColorFactor.value=t}get rimMultiplyTexture(){return this.uniforms.rimMultiplyTexture.value}set rimMultiplyTexture(t){this.uniforms.rimMultiplyTexture.value=t}get rimLightingMixFactor(){return this.uniforms.rimLightingMixFactor.value}set rimLightingMixFactor(t){this.uniforms.rimLightingMixFactor.value=t}get parametricRimFresnelPowerFactor(){return this.uniforms.parametricRimFresnelPowerFactor.value}set parametricRimFresnelPowerFactor(t){this.uniforms.parametricRimFresnelPowerFactor.value=t}get parametricRimLiftFactor(){return this.uniforms.parametricRimLiftFactor.value}set parametricRimLiftFactor(t){this.uniforms.parametricRimLiftFactor.value=t}get outlineWidthMultiplyTexture(){return this.uniforms.outlineWidthMultiplyTexture.value}set outlineWidthMultiplyTexture(t){this.uniforms.outlineWidthMultiplyTexture.value=t}get outlineWidthFactor(){return this.uniforms.outlineWidthFactor.value}set outlineWidthFactor(t){this.uniforms.outlineWidthFactor.value=t}get outlineColorFactor(){return this.uniforms.outlineColorFactor.value}set outlineColorFactor(t){this.uniforms.outlineColorFactor.value=t}get outlineLightingMixFactor(){return this.uniforms.outlineLightingMixFactor.value}set outlineLightingMixFactor(t){this.uniforms.outlineLightingMixFactor.value=t}get uvAnimationMaskTexture(){return this.uniforms.uvAnimationMaskTexture.value}set uvAnimationMaskTexture(t){this.uniforms.uvAnimationMaskTexture.value=t}get uvAnimationScrollXOffset(){return this.uniforms.uvAnimationScrollXOffset.value}set uvAnimationScrollXOffset(t){this.uniforms.uvAnimationScrollXOffset.value=t}get uvAnimationScrollYOffset(){return this.uniforms.uvAnimationScrollYOffset.value}set uvAnimationScrollYOffset(t){this.uniforms.uvAnimationScrollYOffset.value=t}get uvAnimationRotationPhase(){return this.uniforms.uvAnimationRotationPhase.value}set uvAnimationRotationPhase(t){this.uniforms.uvAnimationRotationPhase.value=t}get ignoreVertexColor(){return this._ignoreVertexColor}set ignoreVertexColor(t){this._ignoreVertexColor=t,this.needsUpdate=!0}get v0CompatShade(){return this._v0CompatShade}set v0CompatShade(t){this._v0CompatShade=t,this.needsUpdate=!0}get debugMode(){return this._debugMode}set debugMode(t){this._debugMode=t,this.needsUpdate=!0}get outlineWidthMode(){return this._outlineWidthMode}set outlineWidthMode(t){this._outlineWidthMode=t,this.needsUpdate=!0}get isOutline(){return this._isOutline}set isOutline(t){this._isOutline=t,this.needsUpdate=!0}get isMToonMaterial(){return!0}update(t){this._uploadUniformsWorkaround(),this._updateUVAnimation(t)}copy(t){return super.copy(t),this.map=t.map,this.normalMap=t.normalMap,this.emissiveMap=t.emissiveMap,this.shadeMultiplyTexture=t.shadeMultiplyTexture,this.shadingShiftTexture=t.shadingShiftTexture,this.matcapTexture=t.matcapTexture,this.rimMultiplyTexture=t.rimMultiplyTexture,this.outlineWidthMultiplyTexture=t.outlineWidthMultiplyTexture,this.uvAnimationMaskTexture=t.uvAnimationMaskTexture,this.normalMapType=t.normalMapType,this.uvAnimationScrollXSpeedFactor=t.uvAnimationScrollXSpeedFactor,this.uvAnimationScrollYSpeedFactor=t.uvAnimationScrollYSpeedFactor,this.uvAnimationRotationSpeedFactor=t.uvAnimationRotationSpeedFactor,this.ignoreVertexColor=t.ignoreVertexColor,this.v0CompatShade=t.v0CompatShade,this.debugMode=t.debugMode,this.outlineWidthMode=t.outlineWidthMode,this.isOutline=t.isOutline,this.needsUpdate=!0,this}_updateUVAnimation(t){this.uniforms.uvAnimationScrollXOffset.value+=t*this.uvAnimationScrollXSpeedFactor,this.uniforms.uvAnimationScrollYOffset.value+=t*this.uvAnimationScrollYSpeedFactor,this.uniforms.uvAnimationRotationPhase.value+=t*this.uvAnimationRotationSpeedFactor,this.uniforms.alphaTest.value=this.alphaTest,this.uniformsNeedUpdate=!0}_uploadUniformsWorkaround(){this.uniforms.opacity.value=this.opacity,this._updateTextureMatrix(this.uniforms.map,this.uniforms.mapUvTransform),this._updateTextureMatrix(this.uniforms.normalMap,this.uniforms.normalMapUvTransform),this._updateTextureMatrix(this.uniforms.emissiveMap,this.uniforms.emissiveMapUvTransform),this._updateTextureMatrix(this.uniforms.shadeMultiplyTexture,this.uniforms.shadeMultiplyTextureUvTransform),this._updateTextureMatrix(this.uniforms.shadingShiftTexture,this.uniforms.shadingShiftTextureUvTransform),this._updateTextureMatrix(this.uniforms.matcapTexture,this.uniforms.matcapTextureUvTransform),this._updateTextureMatrix(this.uniforms.rimMultiplyTexture,this.uniforms.rimMultiplyTextureUvTransform),this._updateTextureMatrix(this.uniforms.outlineWidthMultiplyTexture,this.uniforms.outlineWidthMultiplyTextureUvTransform),this._updateTextureMatrix(this.uniforms.uvAnimationMaskTexture,this.uniforms.uvAnimationMaskTextureUvTransform),this.uniformsNeedUpdate=!0}_generateDefines(){const t=parseInt(Xe,10),e=this.outlineWidthMultiplyTexture!==null,n=this.map!==null||this.normalMap!==null||this.emissiveMap!==null||this.shadeMultiplyTexture!==null||this.shadingShiftTexture!==null||this.rimMultiplyTexture!==null||this.uvAnimationMaskTexture!==null;return{THREE_VRM_THREE_REVISION:t,OUTLINE:this._isOutline,MTOON_USE_UV:e||n,MTOON_UVS_VERTEX_ONLY:e&&!n,V0_COMPAT_SHADE:this._v0CompatShade,USE_SHADEMULTIPLYTEXTURE:this.shadeMultiplyTexture!==null,USE_SHADINGSHIFTTEXTURE:this.shadingShiftTexture!==null,USE_MATCAPTEXTURE:this.matcapTexture!==null,USE_RIMMULTIPLYTEXTURE:this.rimMultiplyTexture!==null,USE_OUTLINEWIDTHMULTIPLYTEXTURE:this._isOutline&&this.outlineWidthMultiplyTexture!==null,USE_UVANIMATIONMASKTEXTURE:this.uvAnimationMaskTexture!==null,IGNORE_VERTEX_COLOR:this._ignoreVertexColor===!0,DEBUG_NORMAL:this._debugMode==="normal",DEBUG_LITSHADERATE:this._debugMode==="litShadeRate",DEBUG_UV:this._debugMode==="uv",OUTLINE_WIDTH_SCREEN:this._isOutline&&this._outlineWidthMode===Qn.ScreenCoordinates}}_updateTextureMatrix(t,e){t.value&&(t.value.matrixAutoUpdate&&t.value.updateMatrix(),e.value.copy(t.value.matrix))}},Eo=new Set(["1.0","1.0-beta"]),Ii=class ze{get name(){return ze.EXTENSION_NAME}constructor(e,n={}){var i,r,s,o;this.parser=e,this.materialType=(i=n.materialType)!=null?i:wo,this.renderOrderOffset=(r=n.renderOrderOffset)!=null?r:0,this.v0CompatShade=(s=n.v0CompatShade)!=null?s:!1,this.debugMode=(o=n.debugMode)!=null?o:"none",this._mToonMaterialSet=new Set}beforeRoot(){return ce(this,null,function*(){this._removeUnlitExtensionIfMToonExists()})}afterRoot(e){return ce(this,null,function*(){e.userData.vrmMToonMaterials=Array.from(this._mToonMaterialSet)})}getMaterialType(e){return this._getMToonExtension(e)?this.materialType:null}extendMaterialParams(e,n){const i=this._getMToonExtension(e);return i?this._extendMaterialParams(i,n):null}loadMesh(e){return ce(this,null,function*(){var n;const i=this.parser,s=(n=i.json.meshes)==null?void 0:n[e];if(s==null)throw new Error(`MToonMaterialLoaderPlugin: Attempt to use meshes[${e}] of glTF but the mesh doesn't exist`);const o=s.primitives,l=yield i.loadMesh(e);if(o.length===1){const a=l,u=o[0].material;u!=null&&this._setupPrimitive(a,u)}else{const a=l;for(let u=0;u<o.length;u++){const c=a.children[u],d=o[u].material;d!=null&&this._setupPrimitive(c,d)}}return l})}_removeUnlitExtensionIfMToonExists(){const i=this.parser.json.materials;i==null||i.map((r,s)=>{var o;this._getMToonExtension(s)&&((o=r.extensions)!=null&&o.KHR_materials_unlit)&&delete r.extensions.KHR_materials_unlit})}_getMToonExtension(e){var n,i;const o=(n=this.parser.json.materials)==null?void 0:n[e];if(o==null){console.warn(`MToonMaterialLoaderPlugin: Attempt to use materials[${e}] of glTF but the material doesn't exist`);return}const l=(i=o.extensions)==null?void 0:i[ze.EXTENSION_NAME];if(l==null)return;const a=l.specVersion;if(!Eo.has(a)){console.warn(`MToonMaterialLoaderPlugin: Unknown ${ze.EXTENSION_NAME} specVersion "${a}"`);return}return l}_extendMaterialParams(e,n){return ce(this,null,function*(){var i;delete n.metalness,delete n.roughness;const r=new Mo(this.parser,n);r.assignPrimitive("transparentWithZWrite",e.transparentWithZWrite),r.assignColor("shadeColorFactor",e.shadeColorFactor),r.assignTexture("shadeMultiplyTexture",e.shadeMultiplyTexture,!0),r.assignPrimitive("shadingShiftFactor",e.shadingShiftFactor),r.assignTexture("shadingShiftTexture",e.shadingShiftTexture,!0),r.assignPrimitive("shadingShiftTextureScale",(i=e.shadingShiftTexture)==null?void 0:i.scale),r.assignPrimitive("shadingToonyFactor",e.shadingToonyFactor),r.assignPrimitive("giEqualizationFactor",e.giEqualizationFactor),r.assignColor("matcapFactor",e.matcapFactor),r.assignTexture("matcapTexture",e.matcapTexture,!0),r.assignColor("parametricRimColorFactor",e.parametricRimColorFactor),r.assignTexture("rimMultiplyTexture",e.rimMultiplyTexture,!0),r.assignPrimitive("rimLightingMixFactor",e.rimLightingMixFactor),r.assignPrimitive("parametricRimFresnelPowerFactor",e.parametricRimFresnelPowerFactor),r.assignPrimitive("parametricRimLiftFactor",e.parametricRimLiftFactor),r.assignPrimitive("outlineWidthMode",e.outlineWidthMode),r.assignPrimitive("outlineWidthFactor",e.outlineWidthFactor),r.assignTexture("outlineWidthMultiplyTexture",e.outlineWidthMultiplyTexture,!1),r.assignColor("outlineColorFactor",e.outlineColorFactor),r.assignPrimitive("outlineLightingMixFactor",e.outlineLightingMixFactor),r.assignTexture("uvAnimationMaskTexture",e.uvAnimationMaskTexture,!1),r.assignPrimitive("uvAnimationScrollXSpeedFactor",e.uvAnimationScrollXSpeedFactor),r.assignPrimitive("uvAnimationScrollYSpeedFactor",e.uvAnimationScrollYSpeedFactor),r.assignPrimitive("uvAnimationRotationSpeedFactor",e.uvAnimationRotationSpeedFactor),r.assignPrimitive("v0CompatShade",this.v0CompatShade),r.assignPrimitive("debugMode",this.debugMode),yield r.pending})}_setupPrimitive(e,n){const i=this._getMToonExtension(n);if(i){const r=this._parseRenderOrder(i);e.renderOrder=r+this.renderOrderOffset,this._generateOutline(e),this._addToMaterialSet(e);return}}_shouldGenerateOutline(e){return typeof e.outlineWidthMode=="string"&&e.outlineWidthMode!=="none"&&typeof e.outlineWidthFactor=="number"&&e.outlineWidthFactor>0}_generateOutline(e){const n=e.material;if(!(n instanceof ke)||!this._shouldGenerateOutline(n))return;e.material=[n];const i=n.clone();i.name+=" (Outline)",i.isOutline=!0,i.side=zr,e.material.push(i);const r=e.geometry,s=r.index?r.index.count:r.attributes.position.count/3;r.addGroup(0,s,0),r.addGroup(0,s,1)}_addToMaterialSet(e){const n=e.material,i=new Set;Array.isArray(n)?n.forEach(r=>i.add(r)):i.add(n);for(const r of i)this._mToonMaterialSet.add(r)}_parseRenderOrder(e){var n;return(e.transparentWithZWrite?0:19)+((n=e.renderQueueOffsetNumber)!=null?n:0)}};Ii.EXTENSION_NAME="VRMC_materials_mtoon";var So=Ii,Ao=(t,e,n)=>new Promise((i,r)=>{var s=a=>{try{l(n.next(a))}catch(u){r(u)}},o=a=>{try{l(n.throw(a))}catch(u){r(u)}},l=a=>a.done?i(a.value):Promise.resolve(a.value).then(s,o);l((n=n.apply(t,e)).next())}),Oi=class St{get name(){return St.EXTENSION_NAME}constructor(e){this.parser=e}extendMaterialParams(e,n){return Ao(this,null,function*(){const i=this._getHDREmissiveMultiplierExtension(e);if(i==null)return;console.warn("VRMMaterialsHDREmissiveMultiplierLoaderPlugin: `VRMC_materials_hdr_emissiveMultiplier` is archived. Use `KHR_materials_emissive_strength` instead.");const r=i.emissiveMultiplier;n.emissiveIntensity=r})}_getHDREmissiveMultiplierExtension(e){var n,i;const o=(n=this.parser.json.materials)==null?void 0:n[e];if(o==null){console.warn(`VRMMaterialsHDREmissiveMultiplierLoaderPlugin: Attempt to use materials[${e}] of glTF but the material doesn't exist`);return}const l=(i=o.extensions)==null?void 0:i[St.EXTENSION_NAME];if(l!=null)return l}};Oi.EXTENSION_NAME="VRMC_materials_hdr_emissiveMultiplier";var Lo=Oi,Po=Object.defineProperty,bo=Object.defineProperties,Io=Object.getOwnPropertyDescriptors,Zn=Object.getOwnPropertySymbols,Oo=Object.prototype.hasOwnProperty,No=Object.prototype.propertyIsEnumerable,$n=(t,e,n)=>e in t?Po(t,e,{enumerable:!0,configurable:!0,writable:!0,value:n}):t[e]=n,G=(t,e)=>{for(var n in e||(e={}))Oo.call(e,n)&&$n(t,n,e[n]);if(Zn)for(var n of Zn(e))No.call(e,n)&&$n(t,n,e[n]);return t},Jn=(t,e)=>bo(t,Io(e)),Co=(t,e,n)=>new Promise((i,r)=>{var s=a=>{try{l(n.next(a))}catch(u){r(u)}},o=a=>{try{l(n.throw(a))}catch(u){r(u)}},l=a=>a.done?i(a.value):Promise.resolve(a.value).then(s,o);l((n=n.apply(t,e)).next())});function fe(t){return Math.pow(t,2.2)}var Uo=class{get name(){return"VRMMaterialsV0CompatPlugin"}constructor(t){var e;this.parser=t,this._renderQueueMapTransparent=new Map,this._renderQueueMapTransparentZWrite=new Map;const n=this.parser.json;n.extensionsUsed=(e=n.extensionsUsed)!=null?e:[],n.extensionsUsed.indexOf("KHR_texture_transform")===-1&&n.extensionsUsed.push("KHR_texture_transform")}beforeRoot(){return Co(this,null,function*(){var t;const e=this.parser.json,n=(t=e.extensions)==null?void 0:t.VRM,i=n==null?void 0:n.materialProperties;i&&(this._populateRenderQueueMap(i),i.forEach((r,s)=>{var o,l;const a=(o=e.materials)==null?void 0:o[s];if(a==null){console.warn(`VRMMaterialsV0CompatPlugin: Attempt to use materials[${s}] of glTF but the material doesn't exist`);return}if(r.shader==="VRM/MToon"){const u=this._parseV0MToonProperties(r,a);e.materials[s]=u}else if((l=r.shader)!=null&&l.startsWith("VRM/Unlit")){const u=this._parseV0UnlitProperties(r,a);e.materials[s]=u}else r.shader==="VRM_USE_GLTFSHADER"||console.warn(`VRMMaterialsV0CompatPlugin: Unknown shader: ${r.shader}`)}))})}_parseV0MToonProperties(t,e){var n,i,r,s,o,l,a,u,c,d,h,f,p,m,g,_,y,T,M,x,R,w,S,I,P,b,V,$,Me,Te,Q,k,de,xe,D,Ct,Ut,Vt,Dt,Ft,Bt,Ht,kt,Wt,Gt,zt,jt,Xt,qt,Yt,Kt,Qt,Zt,$t,Jt;const en=(i=(n=t.keywordMap)==null?void 0:n._ALPHABLEND_ON)!=null?i:!1,Bi=((r=t.floatProperties)==null?void 0:r._ZWrite)===1&&en,Hi=this._v0ParseRenderQueue(t),tn=(o=(s=t.keywordMap)==null?void 0:s._ALPHATEST_ON)!=null?o:!1,ki=en?"BLEND":tn?"MASK":"OPAQUE",Wi=tn?(a=(l=t.floatProperties)==null?void 0:l._Cutoff)!=null?a:.5:void 0,Gi=((c=(u=t.floatProperties)==null?void 0:u._CullMode)!=null?c:2)===0,ne=this._portTextureTransform(t),zi=((h=(d=t.vectorProperties)==null?void 0:d._Color)!=null?h:[1,1,1,1]).map((dn,pr)=>pr===3?dn:fe(dn)),nn=(f=t.textureProperties)==null?void 0:f._MainTex,ji=nn!=null?{index:nn,extensions:G({},ne)}:void 0,Xi=(m=(p=t.floatProperties)==null?void 0:p._BumpScale)!=null?m:1,rn=(g=t.textureProperties)==null?void 0:g._BumpMap,qi=rn!=null?{index:rn,scale:Xi,extensions:G({},ne)}:void 0,Yi=((y=(_=t.vectorProperties)==null?void 0:_._EmissionColor)!=null?y:[0,0,0,1]).map(fe),sn=(T=t.textureProperties)==null?void 0:T._EmissionMap,Ki=sn!=null?{index:sn,extensions:G({},ne)}:void 0,Qi=((x=(M=t.vectorProperties)==null?void 0:M._ShadeColor)!=null?x:[.97,.81,.86,1]).map(fe),on=(R=t.textureProperties)==null?void 0:R._ShadeTexture,Zi=on!=null?{index:on,extensions:G({},ne)}:void 0;let Ce=(S=(w=t.floatProperties)==null?void 0:w._ShadeShift)!=null?S:0,Ue=(P=(I=t.floatProperties)==null?void 0:I._ShadeToony)!=null?P:.9;Ue=N.lerp(Ue,1,.5+.5*Ce),Ce=-Ce-(1-Ue);const an=(V=(b=t.floatProperties)==null?void 0:b._IndirectLightIntensity)!=null?V:.1,$i=an?1-an:void 0,Je=($=t.textureProperties)==null?void 0:$._SphereAdd,Ji=Je!=null?[1,1,1]:void 0,er=Je!=null?{index:Je}:void 0,tr=(Te=(Me=t.floatProperties)==null?void 0:Me._RimLightingMix)!=null?Te:0,ln=(Q=t.textureProperties)==null?void 0:Q._RimTexture,nr=ln!=null?{index:ln,extensions:G({},ne)}:void 0,ir=((de=(k=t.vectorProperties)==null?void 0:k._RimColor)!=null?de:[0,0,0,1]).map(fe),rr=(D=(xe=t.floatProperties)==null?void 0:xe._RimFresnelPower)!=null?D:1,sr=(Ut=(Ct=t.floatProperties)==null?void 0:Ct._RimLift)!=null?Ut:0,or=["none","worldCoordinates","screenCoordinates"][(Dt=(Vt=t.floatProperties)==null?void 0:Vt._OutlineWidthMode)!=null?Dt:0];let et=(Bt=(Ft=t.floatProperties)==null?void 0:Ft._OutlineWidth)!=null?Bt:0;et=.01*et;const un=(Ht=t.textureProperties)==null?void 0:Ht._OutlineWidthTexture,ar=un!=null?{index:un,extensions:G({},ne)}:void 0,lr=((Wt=(kt=t.vectorProperties)==null?void 0:kt._OutlineColor)!=null?Wt:[0,0,0]).map(fe),ur=((zt=(Gt=t.floatProperties)==null?void 0:Gt._OutlineColorMode)!=null?zt:0)===1?(Xt=(jt=t.floatProperties)==null?void 0:jt._OutlineLightingMix)!=null?Xt:1:0,cn=(qt=t.textureProperties)==null?void 0:qt._UvAnimMaskTexture,cr=cn!=null?{index:cn,extensions:G({},ne)}:void 0,dr=(Kt=(Yt=t.floatProperties)==null?void 0:Yt._UvAnimScrollX)!=null?Kt:0;let Ve=(Zt=(Qt=t.floatProperties)==null?void 0:Qt._UvAnimScrollY)!=null?Zt:0;Ve!=null&&(Ve=-Ve);const hr=(Jt=($t=t.floatProperties)==null?void 0:$t._UvAnimRotation)!=null?Jt:0,fr={specVersion:"1.0",transparentWithZWrite:Bi,renderQueueOffsetNumber:Hi,shadeColorFactor:Qi,shadeMultiplyTexture:Zi,shadingShiftFactor:Ce,shadingToonyFactor:Ue,giEqualizationFactor:$i,matcapFactor:Ji,matcapTexture:er,rimLightingMixFactor:tr,rimMultiplyTexture:nr,parametricRimColorFactor:ir,parametricRimFresnelPowerFactor:rr,parametricRimLiftFactor:sr,outlineWidthMode:or,outlineWidthFactor:et,outlineWidthMultiplyTexture:ar,outlineColorFactor:lr,outlineLightingMixFactor:ur,uvAnimationMaskTexture:cr,uvAnimationScrollXSpeedFactor:dr,uvAnimationScrollYSpeedFactor:Ve,uvAnimationRotationSpeedFactor:hr};return Jn(G({},e),{pbrMetallicRoughness:{baseColorFactor:zi,baseColorTexture:ji},normalTexture:qi,emissiveTexture:Ki,emissiveFactor:Yi,alphaMode:ki,alphaCutoff:Wi,doubleSided:Gi,extensions:{VRMC_materials_mtoon:fr}})}_parseV0UnlitProperties(t,e){var n,i,r,s,o;const l=t.shader==="VRM/UnlitTransparentZWrite",a=t.shader==="VRM/UnlitTransparent"||l,u=this._v0ParseRenderQueue(t),c=t.shader==="VRM/UnlitCutout",d=a?"BLEND":c?"MASK":"OPAQUE",h=c?(i=(n=t.floatProperties)==null?void 0:n._Cutoff)!=null?i:.5:void 0,f=this._portTextureTransform(t),p=((s=(r=t.vectorProperties)==null?void 0:r._Color)!=null?s:[1,1,1,1]).map(fe),m=(o=t.textureProperties)==null?void 0:o._MainTex,g=m!=null?{index:m,extensions:G({},f)}:void 0,_={specVersion:"1.0",transparentWithZWrite:l,renderQueueOffsetNumber:u,shadeColorFactor:p,shadeMultiplyTexture:g};return Jn(G({},e),{pbrMetallicRoughness:{baseColorFactor:p,baseColorTexture:g},alphaMode:d,alphaCutoff:h,extensions:{VRMC_materials_mtoon:_}})}_portTextureTransform(t){var e,n,i,r,s;const o=(e=t.vectorProperties)==null?void 0:e._MainTex;if(o==null)return{};const l=[(n=o==null?void 0:o[0])!=null?n:0,(i=o==null?void 0:o[1])!=null?i:0],a=[(r=o==null?void 0:o[2])!=null?r:1,(s=o==null?void 0:o[3])!=null?s:1];return l[1]=1-a[1]-l[1],{KHR_texture_transform:{offset:l,scale:a}}}_v0ParseRenderQueue(t){var e,n;const i=t.shader==="VRM/UnlitTransparentZWrite",r=((e=t.keywordMap)==null?void 0:e._ALPHABLEND_ON)!=null||t.shader==="VRM/UnlitTransparent"||i,s=((n=t.floatProperties)==null?void 0:n._ZWrite)===1||i;let o=0;if(r){const l=t.renderQueue;l!=null&&(s?o=this._renderQueueMapTransparentZWrite.get(l):o=this._renderQueueMapTransparent.get(l))}return o}_populateRenderQueueMap(t){const e=new Set,n=new Set;t.forEach(i=>{var r,s;const o=i.shader==="VRM/UnlitTransparentZWrite",l=((r=i.keywordMap)==null?void 0:r._ALPHABLEND_ON)!=null||i.shader==="VRM/UnlitTransparent"||o,a=((s=i.floatProperties)==null?void 0:s._ZWrite)===1||o;if(l){const u=i.renderQueue;u!=null&&(a?n.add(u):e.add(u))}}),e.size>10&&console.warn(`VRMMaterialsV0CompatPlugin: This VRM uses ${e.size} render queues for Transparent materials while VRM 1.0 only supports up to 10 render queues. The model might not be rendered correctly.`),n.size>10&&console.warn(`VRMMaterialsV0CompatPlugin: This VRM uses ${n.size} render queues for TransparentZWrite materials while VRM 1.0 only supports up to 10 render queues. The model might not be rendered correctly.`),Array.from(e).sort().forEach((i,r)=>{const s=Math.min(Math.max(r-e.size+1,-9),0);this._renderQueueMapTransparent.set(i,s)}),Array.from(n).sort().forEach((i,r)=>{const s=Math.min(Math.max(r,0),9);this._renderQueueMapTransparentZWrite.set(i,s)})}},ei=(t,e,n)=>new Promise((i,r)=>{var s=a=>{try{l(n.next(a))}catch(u){r(u)}},o=a=>{try{l(n.throw(a))}catch(u){r(u)}},l=a=>a.done?i(a.value):Promise.resolve(a.value).then(s,o);l((n=n.apply(t,e)).next())}),ee=new v,ut=class extends q{constructor(t){super(),this._attrPosition=new U(new Float32Array([0,0,0,0,0,0]),3),this._attrPosition.setUsage(Kr);const e=new K;e.setAttribute("position",this._attrPosition);const n=new Ne({color:16711935,depthTest:!1,depthWrite:!1});this._line=new hi(e,n),this.add(this._line),this.constraint=t}updateMatrixWorld(t){ee.setFromMatrixPosition(this.constraint.destination.matrixWorld),this._attrPosition.setXYZ(0,ee.x,ee.y,ee.z),this.constraint.source&&ee.setFromMatrixPosition(this.constraint.source.matrixWorld),this._attrPosition.setXYZ(1,ee.x,ee.y,ee.z),this._attrPosition.needsUpdate=!0,super.updateMatrixWorld(t)}};function ti(t,e){return e.set(t.elements[12],t.elements[13],t.elements[14])}var Vo=new v,Do=new v;function Fo(t,e){return t.decompose(Vo,e,Do),e}function Ye(t){return t.invert?t.invert():t.inverse(),t}var Ot=class{constructor(t,e){this.destination=t,this.source=e,this.weight=1}},Bo=new v,Ho=new v,ko=new v,Wo=new A,Go=new A,zo=new A,jo=class extends Ot{get aimAxis(){return this._aimAxis}set aimAxis(t){this._aimAxis=t,this._v3AimAxis.set(t==="PositiveX"?1:t==="NegativeX"?-1:0,t==="PositiveY"?1:t==="NegativeY"?-1:0,t==="PositiveZ"?1:t==="NegativeZ"?-1:0)}get dependencies(){const t=new Set([this.source]);return this.destination.parent&&t.add(this.destination.parent),t}constructor(t,e){super(t,e),this._aimAxis="PositiveX",this._v3AimAxis=new v(1,0,0),this._dstRestQuat=new A}setInitState(){this._dstRestQuat.copy(this.destination.quaternion)}update(){this.destination.updateWorldMatrix(!0,!1),this.source.updateWorldMatrix(!0,!1);const t=Wo.identity(),e=Go.identity();this.destination.parent&&(Fo(this.destination.parent.matrixWorld,t),Ye(e.copy(t)));const n=Bo.copy(this._v3AimAxis).applyQuaternion(this._dstRestQuat).applyQuaternion(t),i=ti(this.source.matrixWorld,Ho).sub(ti(this.destination.matrixWorld,ko)).normalize(),r=zo.setFromUnitVectors(n,i).premultiply(e).multiply(t).multiply(this._dstRestQuat);this.destination.quaternion.copy(this._dstRestQuat).slerp(r,this.weight)}};function Xo(t,e){const n=[t];let i=t.parent;for(;i!==null;)n.unshift(i),i=i.parent;n.forEach(r=>{e(r)})}var qo=class{constructor(){this._constraints=new Set,this._objectConstraintsMap=new Map}get constraints(){return this._constraints}addConstraint(t){this._constraints.add(t);let e=this._objectConstraintsMap.get(t.destination);e==null&&(e=new Set,this._objectConstraintsMap.set(t.destination,e)),e.add(t)}deleteConstraint(t){this._constraints.delete(t),this._objectConstraintsMap.get(t.destination).delete(t)}setInitState(){const t=new Set,e=new Set;for(const n of this._constraints)this._processConstraint(n,t,e,i=>i.setInitState())}update(){const t=new Set,e=new Set;for(const n of this._constraints)this._processConstraint(n,t,e,i=>i.update())}_processConstraint(t,e,n,i){if(n.has(t))return;if(e.has(t))throw new Error("VRMNodeConstraintManager: Circular dependency detected while updating constraints");e.add(t);const r=t.dependencies;for(const s of r)Xo(s,o=>{const l=this._objectConstraintsMap.get(o);if(l)for(const a of l)this._processConstraint(a,e,n,i)});i(t),n.add(t)}},Yo=new A,Ko=new A,Qo=class extends Ot{get dependencies(){return new Set([this.source])}constructor(t,e){super(t,e),this._dstRestQuat=new A,this._invSrcRestQuat=new A}setInitState(){this._dstRestQuat.copy(this.destination.quaternion),Ye(this._invSrcRestQuat.copy(this.source.quaternion))}update(){const t=Yo.copy(this._invSrcRestQuat).multiply(this.source.quaternion),e=Ko.copy(this._dstRestQuat).multiply(t);this.destination.quaternion.copy(this._dstRestQuat).slerp(e,this.weight)}},Zo=new v,$o=new A,Jo=new A,ea=class extends Ot{get rollAxis(){return this._rollAxis}set rollAxis(t){this._rollAxis=t,this._v3RollAxis.set(t==="X"?1:0,t==="Y"?1:0,t==="Z"?1:0)}get dependencies(){return new Set([this.source])}constructor(t,e){super(t,e),this._rollAxis="X",this._v3RollAxis=new v(1,0,0),this._dstRestQuat=new A,this._invDstRestQuat=new A,this._invSrcRestQuatMulDstRestQuat=new A}setInitState(){this._dstRestQuat.copy(this.destination.quaternion),Ye(this._invDstRestQuat.copy(this._dstRestQuat)),Ye(this._invSrcRestQuatMulDstRestQuat.copy(this.source.quaternion)).multiply(this._dstRestQuat)}update(){const t=$o.copy(this._invDstRestQuat).multiply(this.source.quaternion).multiply(this._invSrcRestQuatMulDstRestQuat),e=Zo.copy(this._v3RollAxis).applyQuaternion(t),i=Jo.setFromUnitVectors(e,this._v3RollAxis).premultiply(this._dstRestQuat).multiply(t);this.destination.quaternion.copy(this._dstRestQuat).slerp(i,this.weight)}},ta=new Set(["1.0","1.0-beta"]),Ni=class be{get name(){return be.EXTENSION_NAME}constructor(e,n){this.parser=e,this.helperRoot=n==null?void 0:n.helperRoot}afterRoot(e){return ei(this,null,function*(){e.userData.vrmNodeConstraintManager=yield this._import(e)})}_import(e){return ei(this,null,function*(){var n;const i=this.parser.json;if(!(((n=i.extensionsUsed)==null?void 0:n.indexOf(be.EXTENSION_NAME))!==-1))return null;const s=new qo,o=yield this.parser.getDependencies("node");return o.forEach((l,a)=>{var u;const c=i.nodes[a],d=(u=c==null?void 0:c.extensions)==null?void 0:u[be.EXTENSION_NAME];if(d==null)return;const h=d.specVersion;if(!ta.has(h)){console.warn(`VRMNodeConstraintLoaderPlugin: Unknown ${be.EXTENSION_NAME} specVersion "${h}"`);return}const f=d.constraint;if(f.roll!=null){const p=this._importRollConstraint(l,o,f.roll);s.addConstraint(p)}else if(f.aim!=null){const p=this._importAimConstraint(l,o,f.aim);s.addConstraint(p)}else if(f.rotation!=null){const p=this._importRotationConstraint(l,o,f.rotation);s.addConstraint(p)}}),e.scene.updateMatrixWorld(),s.setInitState(),s})}_importRollConstraint(e,n,i){const{source:r,rollAxis:s,weight:o}=i,l=n[r],a=new ea(e,l);if(s!=null&&(a.rollAxis=s),o!=null&&(a.weight=o),this.helperRoot){const u=new ut(a);this.helperRoot.add(u)}return a}_importAimConstraint(e,n,i){const{source:r,aimAxis:s,weight:o}=i,l=n[r],a=new jo(e,l);if(s!=null&&(a.aimAxis=s),o!=null&&(a.weight=o),this.helperRoot){const u=new ut(a);this.helperRoot.add(u)}return a}_importRotationConstraint(e,n,i){const{source:r,weight:s}=i,o=n[r],l=new Qo(e,o);if(s!=null&&(l.weight=s),this.helperRoot){const a=new ut(l);this.helperRoot.add(a)}return l}};Ni.EXTENSION_NAME="VRMC_node_constraint";var na=Ni,He=(t,e,n)=>new Promise((i,r)=>{var s=a=>{try{l(n.next(a))}catch(u){r(u)}},o=a=>{try{l(n.throw(a))}catch(u){r(u)}},l=a=>a.done?i(a.value):Promise.resolve(a.value).then(s,o);l((n=n.apply(t,e)).next())}),Nt=class{},ct=new v,oe=new v,Ci=class extends Nt{get type(){return"capsule"}constructor(t){var e,n,i,r;super(),this.offset=(e=t==null?void 0:t.offset)!=null?e:new v(0,0,0),this.tail=(n=t==null?void 0:t.tail)!=null?n:new v(0,0,0),this.radius=(i=t==null?void 0:t.radius)!=null?i:0,this.inside=(r=t==null?void 0:t.inside)!=null?r:!1}calculateCollision(t,e,n,i){ct.setFromMatrixPosition(t),oe.subVectors(this.tail,this.offset).applyMatrix4(t),oe.sub(ct);const r=oe.lengthSq();i.copy(e).sub(ct);const s=oe.dot(i);s<=0||(r<=s||oe.multiplyScalar(s/r),i.sub(oe));const o=i.length(),l=this.inside?this.radius-n-o:o-n-this.radius;return l<0&&(i.multiplyScalar(1/o),this.inside&&i.negate()),l}},dt=new v,ni=new j,Ui=class extends Nt{get type(){return"plane"}constructor(t){var e,n;super(),this.offset=(e=t==null?void 0:t.offset)!=null?e:new v(0,0,0),this.normal=(n=t==null?void 0:t.normal)!=null?n:new v(0,0,1)}calculateCollision(t,e,n,i){i.setFromMatrixPosition(t),i.negate().add(e),ni.getNormalMatrix(t),dt.copy(this.normal).applyNormalMatrix(ni).normalize();const r=i.dot(dt)-n;return i.copy(dt),r}},ia=new v,Vi=class extends Nt{get type(){return"sphere"}constructor(t){var e,n,i;super(),this.offset=(e=t==null?void 0:t.offset)!=null?e:new v(0,0,0),this.radius=(n=t==null?void 0:t.radius)!=null?n:0,this.inside=(i=t==null?void 0:t.inside)!=null?i:!1}calculateCollision(t,e,n,i){i.subVectors(e,ia.setFromMatrixPosition(t));const r=i.length(),s=this.inside?this.radius-n-r:r-n-this.radius;return s<0&&(i.multiplyScalar(1/r),this.inside&&i.negate()),s}},z=new v,ra=class extends K{constructor(t){super(),this.worldScale=1,this._currentRadius=0,this._currentOffset=new v,this._currentTail=new v,this._shape=t,this._attrPos=new U(new Float32Array(396),3),this.setAttribute("position",this._attrPos),this._attrIndex=new U(new Uint16Array(264),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let t=!1;const e=this._shape.radius/this.worldScale;this._currentRadius!==e&&(this._currentRadius=e,t=!0),this._currentOffset.equals(this._shape.offset)||(this._currentOffset.copy(this._shape.offset),t=!0);const n=z.copy(this._shape.tail).divideScalar(this.worldScale);this._currentTail.distanceToSquared(n)>1e-10&&(this._currentTail.copy(n),t=!0),t&&this._buildPosition()}_buildPosition(){z.copy(this._currentTail).sub(this._currentOffset);const t=z.length()/this._currentRadius;for(let i=0;i<=16;i++){const r=i/16*Math.PI;this._attrPos.setXYZ(i,-Math.sin(r),-Math.cos(r),0),this._attrPos.setXYZ(17+i,t+Math.sin(r),Math.cos(r),0),this._attrPos.setXYZ(34+i,-Math.sin(r),0,-Math.cos(r)),this._attrPos.setXYZ(51+i,t+Math.sin(r),0,Math.cos(r))}for(let i=0;i<32;i++){const r=i/16*Math.PI;this._attrPos.setXYZ(68+i,0,Math.sin(r),Math.cos(r)),this._attrPos.setXYZ(100+i,t,Math.sin(r),Math.cos(r))}const e=Math.atan2(z.y,Math.sqrt(z.x*z.x+z.z*z.z)),n=-Math.atan2(z.z,z.x);this.rotateZ(e),this.rotateY(n),this.scale(this._currentRadius,this._currentRadius,this._currentRadius),this.translate(this._currentOffset.x,this._currentOffset.y,this._currentOffset.z),this._attrPos.needsUpdate=!0}_buildIndex(){for(let t=0;t<34;t++){const e=(t+1)%34;this._attrIndex.setXY(t*2,t,e),this._attrIndex.setXY(68+t*2,34+t,34+e)}for(let t=0;t<32;t++){const e=(t+1)%32;this._attrIndex.setXY(136+t*2,68+t,68+e),this._attrIndex.setXY(200+t*2,100+t,100+e)}this._attrIndex.needsUpdate=!0}},sa=class extends K{constructor(t){super(),this.worldScale=1,this._currentOffset=new v,this._currentNormal=new v,this._shape=t,this._attrPos=new U(new Float32Array(18),3),this.setAttribute("position",this._attrPos),this._attrIndex=new U(new Uint16Array(10),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let t=!1;this._currentOffset.equals(this._shape.offset)||(this._currentOffset.copy(this._shape.offset),t=!0),this._currentNormal.equals(this._shape.normal)||(this._currentNormal.copy(this._shape.normal),t=!0),t&&this._buildPosition()}_buildPosition(){this._attrPos.setXYZ(0,-.5,-.5,0),this._attrPos.setXYZ(1,.5,-.5,0),this._attrPos.setXYZ(2,.5,.5,0),this._attrPos.setXYZ(3,-.5,.5,0),this._attrPos.setXYZ(4,0,0,0),this._attrPos.setXYZ(5,0,0,.25),this.translate(this._currentOffset.x,this._currentOffset.y,this._currentOffset.z),this.lookAt(this._currentNormal),this._attrPos.needsUpdate=!0}_buildIndex(){this._attrIndex.setXY(0,0,1),this._attrIndex.setXY(2,1,2),this._attrIndex.setXY(4,2,3),this._attrIndex.setXY(6,3,0),this._attrIndex.setXY(8,4,5),this._attrIndex.needsUpdate=!0}},oa=class extends K{constructor(t){super(),this.worldScale=1,this._currentRadius=0,this._currentOffset=new v,this._shape=t,this._attrPos=new U(new Float32Array(288),3),this.setAttribute("position",this._attrPos),this._attrIndex=new U(new Uint16Array(192),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let t=!1;const e=this._shape.radius/this.worldScale;this._currentRadius!==e&&(this._currentRadius=e,t=!0),this._currentOffset.equals(this._shape.offset)||(this._currentOffset.copy(this._shape.offset),t=!0),t&&this._buildPosition()}_buildPosition(){for(let t=0;t<32;t++){const e=t/16*Math.PI;this._attrPos.setXYZ(t,Math.cos(e),Math.sin(e),0),this._attrPos.setXYZ(32+t,0,Math.cos(e),Math.sin(e)),this._attrPos.setXYZ(64+t,Math.sin(e),0,Math.cos(e))}this.scale(this._currentRadius,this._currentRadius,this._currentRadius),this.translate(this._currentOffset.x,this._currentOffset.y,this._currentOffset.z),this._attrPos.needsUpdate=!0}_buildIndex(){for(let t=0;t<32;t++){const e=(t+1)%32;this._attrIndex.setXY(t*2,t,e),this._attrIndex.setXY(64+t*2,32+t,32+e),this._attrIndex.setXY(128+t*2,64+t,64+e)}this._attrIndex.needsUpdate=!0}},aa=new v,ht=class extends q{constructor(t){if(super(),this.matrixAutoUpdate=!1,this.collider=t,this.collider.shape instanceof Vi)this._geometry=new oa(this.collider.shape);else if(this.collider.shape instanceof Ci)this._geometry=new ra(this.collider.shape);else if(this.collider.shape instanceof Ui)this._geometry=new sa(this.collider.shape);else throw new Error("VRMSpringBoneColliderHelper: Unknown collider shape type detected");const e=new Ne({color:16711935,depthTest:!1,depthWrite:!1});this._line=new Ze(this._geometry,e),this.add(this._line)}dispose(){this._geometry.dispose()}updateMatrixWorld(t){this.collider.updateWorldMatrix(!0,!1),this.matrix.copy(this.collider.matrixWorld);const e=this.matrix.elements;this._geometry.worldScale=aa.set(e[0],e[1],e[2]).length(),this._geometry.update(),super.updateMatrixWorld(t)}},la=class extends K{constructor(t){super(),this.worldScale=1,this._currentRadius=0,this._currentTail=new v,this._springBone=t,this._attrPos=new U(new Float32Array(294),3),this.setAttribute("position",this._attrPos),this._attrIndex=new U(new Uint16Array(194),1),this.setIndex(this._attrIndex),this._buildIndex(),this.update()}update(){let t=!1;const e=this._springBone.settings.hitRadius/this.worldScale;this._currentRadius!==e&&(this._currentRadius=e,t=!0),this._currentTail.equals(this._springBone.initialLocalChildPosition)||(this._currentTail.copy(this._springBone.initialLocalChildPosition),t=!0),t&&this._buildPosition()}_buildPosition(){for(let t=0;t<32;t++){const e=t/16*Math.PI;this._attrPos.setXYZ(t,Math.cos(e),Math.sin(e),0),this._attrPos.setXYZ(32+t,0,Math.cos(e),Math.sin(e)),this._attrPos.setXYZ(64+t,Math.sin(e),0,Math.cos(e))}this.scale(this._currentRadius,this._currentRadius,this._currentRadius),this.translate(this._currentTail.x,this._currentTail.y,this._currentTail.z),this._attrPos.setXYZ(96,0,0,0),this._attrPos.setXYZ(97,this._currentTail.x,this._currentTail.y,this._currentTail.z),this._attrPos.needsUpdate=!0}_buildIndex(){for(let t=0;t<32;t++){const e=(t+1)%32;this._attrIndex.setXY(t*2,t,e),this._attrIndex.setXY(64+t*2,32+t,32+e),this._attrIndex.setXY(128+t*2,64+t,64+e)}this._attrIndex.setXY(192,96,97),this._attrIndex.needsUpdate=!0}},ua=new v,ca=class extends q{constructor(t){super(),this.matrixAutoUpdate=!1,this.springBone=t,this._geometry=new la(this.springBone);const e=new Ne({color:16776960,depthTest:!1,depthWrite:!1});this._line=new Ze(this._geometry,e),this.add(this._line)}dispose(){this._geometry.dispose()}updateMatrixWorld(t){this.springBone.bone.updateWorldMatrix(!0,!1),this.matrix.copy(this.springBone.bone.matrixWorld);const e=this.matrix.elements;this._geometry.worldScale=ua.set(e[0],e[1],e[2]).length(),this._geometry.update(),super.updateMatrixWorld(t)}},ft=class extends ve{constructor(t){super(),this.colliderMatrix=new F,this.shape=t}updateWorldMatrix(t,e){super.updateWorldMatrix(t,e),da(this.colliderMatrix,this.matrixWorld,this.shape.offset)}};function da(t,e,n){const i=e.elements;t.copy(e),n&&(t.elements[12]=i[0]*n.x+i[4]*n.y+i[8]*n.z+i[12],t.elements[13]=i[1]*n.x+i[5]*n.y+i[9]*n.z+i[13],t.elements[14]=i[2]*n.x+i[6]*n.y+i[10]*n.z+i[14])}var ha=new F;function fa(t){return t.invert?t.invert():t.getInverse(ha.copy(t)),t}var pa=class{constructor(t){this._inverseCache=new F,this._shouldUpdateInverse=!0,this.matrix=t;const e={set:(n,i,r)=>(this._shouldUpdateInverse=!0,n[i]=r,!0)};this._originalElements=t.elements,t.elements=new Proxy(t.elements,e)}get inverse(){return this._shouldUpdateInverse&&(fa(this._inverseCache.copy(this.matrix)),this._shouldUpdateInverse=!1),this._inverseCache}revert(){this.matrix.elements=this._originalElements}},pt=new F,pe=new v,Ae=new v,Le=new v,Pe=new v,ma=new F,ga=class{constructor(t,e,n={},i=[]){this._currentTail=new v,this._prevTail=new v,this._boneAxis=new v,this._worldSpaceBoneLength=0,this._center=null,this._initialLocalMatrix=new F,this._initialLocalRotation=new A,this._initialLocalChildPosition=new v;var r,s,o,l,a,u;this.bone=t,this.bone.matrixAutoUpdate=!1,this.child=e,this.settings={hitRadius:(r=n.hitRadius)!=null?r:0,stiffness:(s=n.stiffness)!=null?s:1,gravityPower:(o=n.gravityPower)!=null?o:0,gravityDir:(a=(l=n.gravityDir)==null?void 0:l.clone())!=null?a:new v(0,-1,0),dragForce:(u=n.dragForce)!=null?u:.4},this.colliderGroups=i}get dependencies(){const t=new Set,e=this.bone.parent;e&&t.add(e);for(let n=0;n<this.colliderGroups.length;n++)for(let i=0;i<this.colliderGroups[n].colliders.length;i++)t.add(this.colliderGroups[n].colliders[i]);return t}get center(){return this._center}set center(t){var e;(e=this._center)!=null&&e.userData.inverseCacheProxy&&(this._center.userData.inverseCacheProxy.revert(),delete this._center.userData.inverseCacheProxy),this._center=t,this._center&&(this._center.userData.inverseCacheProxy||(this._center.userData.inverseCacheProxy=new pa(this._center.matrixWorld)))}get initialLocalChildPosition(){return this._initialLocalChildPosition}get _parentMatrixWorld(){return this.bone.parent?this.bone.parent.matrixWorld:pt}setInitState(){this._initialLocalMatrix.copy(this.bone.matrix),this._initialLocalRotation.copy(this.bone.quaternion),this.child?this._initialLocalChildPosition.copy(this.child.position):this._initialLocalChildPosition.copy(this.bone.position).normalize().multiplyScalar(.07);const t=this._getMatrixWorldToCenter();this.bone.localToWorld(this._currentTail.copy(this._initialLocalChildPosition)).applyMatrix4(t),this._prevTail.copy(this._currentTail),this._boneAxis.copy(this._initialLocalChildPosition).normalize()}reset(){this.bone.quaternion.copy(this._initialLocalRotation),this.bone.updateMatrix(),this.bone.matrixWorld.multiplyMatrices(this._parentMatrixWorld,this.bone.matrix);const t=this._getMatrixWorldToCenter();this.bone.localToWorld(this._currentTail.copy(this._initialLocalChildPosition)).applyMatrix4(t),this._prevTail.copy(this._currentTail)}update(t){if(t<=0)return;this._calcWorldSpaceBoneLength();const e=Ae.copy(this._boneAxis).transformDirection(this._initialLocalMatrix).transformDirection(this._parentMatrixWorld);Pe.copy(this._currentTail).add(pe.subVectors(this._currentTail,this._prevTail).multiplyScalar(1-this.settings.dragForce)).applyMatrix4(this._getMatrixCenterToWorld()).addScaledVector(e,this.settings.stiffness*t).addScaledVector(this.settings.gravityDir,this.settings.gravityPower*t),Le.setFromMatrixPosition(this.bone.matrixWorld),Pe.sub(Le).normalize().multiplyScalar(this._worldSpaceBoneLength).add(Le),this._collision(Pe),this._prevTail.copy(this._currentTail),this._currentTail.copy(Pe).applyMatrix4(this._getMatrixWorldToCenter());const n=ma.multiplyMatrices(this._parentMatrixWorld,this._initialLocalMatrix).invert();this.bone.quaternion.setFromUnitVectors(this._boneAxis,pe.copy(Pe).applyMatrix4(n).normalize()).premultiply(this._initialLocalRotation),this.bone.updateMatrix(),this.bone.matrixWorld.multiplyMatrices(this._parentMatrixWorld,this.bone.matrix)}_collision(t){for(let e=0;e<this.colliderGroups.length;e++)for(let n=0;n<this.colliderGroups[e].colliders.length;n++){const i=this.colliderGroups[e].colliders[n],r=i.shape.calculateCollision(i.colliderMatrix,t,this.settings.hitRadius,pe);if(r<0){t.addScaledVector(pe,-r),t.sub(Le);const s=t.length();t.multiplyScalar(this._worldSpaceBoneLength/s).add(Le)}}}_calcWorldSpaceBoneLength(){pe.setFromMatrixPosition(this.bone.matrixWorld),this.child?Ae.setFromMatrixPosition(this.child.matrixWorld):(Ae.copy(this._initialLocalChildPosition),Ae.applyMatrix4(this.bone.matrixWorld)),this._worldSpaceBoneLength=pe.sub(Ae).length()}_getMatrixCenterToWorld(){return this._center?this._center.matrixWorld:pt}_getMatrixWorldToCenter(){return this._center?this._center.userData.inverseCacheProxy.inverse:pt}};function _a(t,e){const n=[];let i=t;for(;i!==null;)n.unshift(i),i=i.parent;n.forEach(r=>{e(r)})}function At(t,e){t.children.forEach(n=>{e(n)||At(n,e)})}function va(t){var e;const n=new Map;for(const i of t){let r=i;do{const s=((e=n.get(r))!=null?e:0)+1;if(s===t.size)return r;n.set(r,s),r=r.parent}while(r!==null)}return null}var ii=class{constructor(){this._joints=new Set,this._sortedJoints=[],this._hasWarnedCircularDependency=!1,this._ancestors=[],this._objectSpringBonesMap=new Map,this._isSortedJointsDirty=!1,this._relevantChildrenUpdated=this._relevantChildrenUpdated.bind(this)}get joints(){return this._joints}get springBones(){return console.warn("VRMSpringBoneManager: springBones is deprecated. use joints instead."),this._joints}get colliderGroups(){const t=new Set;return this._joints.forEach(e=>{e.colliderGroups.forEach(n=>{t.add(n)})}),Array.from(t)}get colliders(){const t=new Set;return this.colliderGroups.forEach(e=>{e.colliders.forEach(n=>{t.add(n)})}),Array.from(t)}addJoint(t){this._joints.add(t);let e=this._objectSpringBonesMap.get(t.bone);e==null&&(e=new Set,this._objectSpringBonesMap.set(t.bone,e)),e.add(t),this._isSortedJointsDirty=!0}addSpringBone(t){console.warn("VRMSpringBoneManager: addSpringBone() is deprecated. use addJoint() instead."),this.addJoint(t)}deleteJoint(t){this._joints.delete(t),this._objectSpringBonesMap.get(t.bone).delete(t),this._isSortedJointsDirty=!0}deleteSpringBone(t){console.warn("VRMSpringBoneManager: deleteSpringBone() is deprecated. use deleteJoint() instead."),this.deleteJoint(t)}setInitState(){this._sortJoints();for(let t=0;t<this._sortedJoints.length;t++){const e=this._sortedJoints[t];e.bone.updateMatrix(),e.bone.updateWorldMatrix(!1,!1),e.setInitState()}}reset(){this._sortJoints();for(let t=0;t<this._sortedJoints.length;t++){const e=this._sortedJoints[t];e.bone.updateMatrix(),e.bone.updateWorldMatrix(!1,!1),e.reset()}}update(t){this._sortJoints();for(let e=0;e<this._ancestors.length;e++)this._ancestors[e].updateWorldMatrix(e===0,!1);for(let e=0;e<this._sortedJoints.length;e++){const n=this._sortedJoints[e];n.bone.updateMatrix(),n.bone.updateWorldMatrix(!1,!1),n.update(t),At(n.bone,this._relevantChildrenUpdated)}}_sortJoints(){if(!this._isSortedJointsDirty)return;const t=[],e=new Set,n=new Set,i=new Set;for(const s of this._joints)this._insertJointSort(s,e,n,t,i);this._sortedJoints=t;const r=va(i);this._ancestors=[],r&&(this._ancestors.push(r),At(r,s=>{var o,l;return((l=(o=this._objectSpringBonesMap.get(s))==null?void 0:o.size)!=null?l:0)>0?!0:(this._ancestors.push(s),!1)})),this._isSortedJointsDirty=!1}_insertJointSort(t,e,n,i,r){if(n.has(t))return;if(e.has(t)){this._hasWarnedCircularDependency||(console.warn("VRMSpringBoneManager: Circular dependency detected"),this._hasWarnedCircularDependency=!0);return}e.add(t);const s=t.dependencies;for(const o of s){let l=!1,a=null;_a(o,u=>{const c=this._objectSpringBonesMap.get(u);if(c)for(const d of c)l=!0,this._insertJointSort(d,e,n,i,r);else l||(a=u)}),a&&r.add(a)}i.push(t),n.add(t)}_relevantChildrenUpdated(t){var e,n;return((n=(e=this._objectSpringBonesMap.get(t))==null?void 0:e.size)!=null?n:0)>0?!0:(t.updateWorldMatrix(!1,!1),!1)}},ri="VRMC_springBone_extended_collider",Ma=new Set(["1.0","1.0-beta"]),Ta=new Set(["1.0"]),Di=class ge{get name(){return ge.EXTENSION_NAME}constructor(e,n){var i;this.parser=e,this.jointHelperRoot=n==null?void 0:n.jointHelperRoot,this.colliderHelperRoot=n==null?void 0:n.colliderHelperRoot,this.useExtendedColliders=(i=n==null?void 0:n.useExtendedColliders)!=null?i:!0}afterRoot(e){return He(this,null,function*(){e.userData.vrmSpringBoneManager=yield this._import(e)})}_import(e){return He(this,null,function*(){const n=yield this._v1Import(e);if(n!=null)return n;const i=yield this._v0Import(e);return i??null})}_v1Import(e){return He(this,null,function*(){var n,i,r,s,o;const l=e.parser.json;if(!(((n=l.extensionsUsed)==null?void 0:n.indexOf(ge.EXTENSION_NAME))!==-1))return null;const u=new ii,c=yield e.parser.getDependencies("node"),d=(i=l.extensions)==null?void 0:i[ge.EXTENSION_NAME];if(!d)return null;const h=d.specVersion;if(!Ma.has(h))return console.warn(`VRMSpringBoneLoaderPlugin: Unknown ${ge.EXTENSION_NAME} specVersion "${h}"`),null;const f=(r=d.colliders)==null?void 0:r.map((m,g)=>{var _,y,T,M,x,R,w,S,I,P,b,V,$,Me,Te;const Q=c[m.node];if(Q==null)return console.warn(`VRMSpringBoneLoaderPlugin: The collider #${g} attempted to use the node #${m.node} but not found`),null;const k=m.shape,de=(_=m.extensions)==null?void 0:_[ri];if(this.useExtendedColliders&&de!=null){const xe=de.specVersion;if(!Ta.has(xe))console.warn(`VRMSpringBoneLoaderPlugin: Unknown ${ri} specVersion "${xe}". Fallbacking to the ${ge.EXTENSION_NAME} definition`);else{const D=de.shape;if(D.sphere)return this._importSphereCollider(Q,{offset:new v().fromArray((y=D.sphere.offset)!=null?y:[0,0,0]),radius:(T=D.sphere.radius)!=null?T:0,inside:(M=D.sphere.inside)!=null?M:!1});if(D.capsule)return this._importCapsuleCollider(Q,{offset:new v().fromArray((x=D.capsule.offset)!=null?x:[0,0,0]),radius:(R=D.capsule.radius)!=null?R:0,tail:new v().fromArray((w=D.capsule.tail)!=null?w:[0,0,0]),inside:(S=D.capsule.inside)!=null?S:!1});if(D.plane)return this._importPlaneCollider(Q,{offset:new v().fromArray((I=D.plane.offset)!=null?I:[0,0,0]),normal:new v().fromArray((P=D.plane.normal)!=null?P:[0,0,1])})}}if(k.sphere)return this._importSphereCollider(Q,{offset:new v().fromArray((b=k.sphere.offset)!=null?b:[0,0,0]),radius:(V=k.sphere.radius)!=null?V:0,inside:!1});if(k.capsule)return this._importCapsuleCollider(Q,{offset:new v().fromArray(($=k.capsule.offset)!=null?$:[0,0,0]),radius:(Me=k.capsule.radius)!=null?Me:0,tail:new v().fromArray((Te=k.capsule.tail)!=null?Te:[0,0,0]),inside:!1});throw new Error(`VRMSpringBoneLoaderPlugin: The collider #${g} has no valid shape`)}),p=(s=d.colliderGroups)==null?void 0:s.map((m,g)=>{var _;return{colliders:((_=m.colliders)!=null?_:[]).flatMap(T=>{const M=f==null?void 0:f[T];return M??(console.warn(`VRMSpringBoneLoaderPlugin: The colliderGroup #${g} attempted to use a collider #${T} but not found`),[])}),name:m.name}});return(o=d.springs)==null||o.forEach((m,g)=>{var _;const y=m.joints,T=(_=m.colliderGroups)==null?void 0:_.map(R=>{const w=p==null?void 0:p[R];if(w==null)throw new Error(`VRMSpringBoneLoaderPlugin: The spring #${g} attempted to use a colliderGroup ${R} but not found`);return w}),M=m.center!=null?c[m.center]:void 0;let x;y.forEach(R=>{if(x){const w=x.node,S=c[w],I=R.node,P=c[I],b={hitRadius:x.hitRadius,dragForce:x.dragForce,gravityPower:x.gravityPower,stiffness:x.stiffness,gravityDir:x.gravityDir!=null?new v().fromArray(x.gravityDir):void 0},V=this._importJoint(S,P,b,T);M&&(V.center=M),u.addJoint(V)}x=R})}),u.setInitState(),u})}_v0Import(e){return He(this,null,function*(){var n,i,r;const s=e.parser.json;if(!(((n=s.extensionsUsed)==null?void 0:n.indexOf("VRM"))!==-1))return null;const l=(i=s.extensions)==null?void 0:i.VRM,a=l==null?void 0:l.secondaryAnimation;if(!a)return null;const u=a==null?void 0:a.boneGroups;if(!u)return null;const c=new ii,d=yield e.parser.getDependencies("node"),h=(r=a.colliderGroups)==null?void 0:r.map(f=>{var p;const m=d[f.node];return{colliders:((p=f.colliders)!=null?p:[]).map((_,y)=>{var T,M,x;const R=new v(0,0,0);return _.offset&&R.set((T=_.offset.x)!=null?T:0,(M=_.offset.y)!=null?M:0,_.offset.z?-_.offset.z:0),this._importSphereCollider(m,{offset:R,radius:(x=_.radius)!=null?x:0,inside:!1})})}});return u==null||u.forEach((f,p)=>{const m=f.bones;m&&m.forEach(g=>{var _,y,T,M;const x=d[g],R=new v;f.gravityDir?R.set((_=f.gravityDir.x)!=null?_:0,(y=f.gravityDir.y)!=null?y:0,(T=f.gravityDir.z)!=null?T:0):R.set(0,-1,0);const w=f.center!=null?d[f.center]:void 0,S={hitRadius:f.hitRadius,dragForce:f.dragForce,gravityPower:f.gravityPower,stiffness:f.stiffiness,gravityDir:R},I=(M=f.colliderGroups)==null?void 0:M.map(P=>{const b=h==null?void 0:h[P];if(b==null)throw new Error(`VRMSpringBoneLoaderPlugin: The spring #${p} attempted to use a colliderGroup ${P} but not found`);return b});x.traverse(P=>{var b;const V=(b=P.children[0])!=null?b:null,$=this._importJoint(P,V,S,I);w&&($.center=w),c.addJoint($)})})}),e.scene.updateMatrixWorld(),c.setInitState(),c})}_importJoint(e,n,i,r){const s=new ga(e,n,i,r);if(this.jointHelperRoot){const o=new ca(s);this.jointHelperRoot.add(o),o.renderOrder=this.jointHelperRoot.renderOrder}return s}_importSphereCollider(e,n){const i=new Vi(n),r=new ft(i);if(e.add(r),this.colliderHelperRoot){const s=new ht(r);this.colliderHelperRoot.add(s),s.renderOrder=this.colliderHelperRoot.renderOrder}return r}_importCapsuleCollider(e,n){const i=new Ci(n),r=new ft(i);if(e.add(r),this.colliderHelperRoot){const s=new ht(r);this.colliderHelperRoot.add(s),s.renderOrder=this.colliderHelperRoot.renderOrder}return r}_importPlaneCollider(e,n){const i=new Ui(n),r=new ft(i);if(e.add(r),this.colliderHelperRoot){const s=new ht(r);this.colliderHelperRoot.add(s),s.renderOrder=this.colliderHelperRoot.renderOrder}return r}};Di.EXTENSION_NAME="VRMC_springBone";var xa=Di,ya=class{get name(){return"VRMLoaderPlugin"}constructor(t,e){var n,i,r,s,o,l,a,u,c,d;this.parser=t;const h=e==null?void 0:e.helperRoot,f=e==null?void 0:e.autoUpdateHumanBones;this.expressionPlugin=(n=e==null?void 0:e.expressionPlugin)!=null?n:new Ds(t),this.firstPersonPlugin=(i=e==null?void 0:e.firstPersonPlugin)!=null?i:new Bs(t),this.humanoidPlugin=(r=e==null?void 0:e.humanoidPlugin)!=null?r:new Xs(t,{helperRoot:h,autoUpdateHumanBones:f}),this.lookAtPlugin=(s=e==null?void 0:e.lookAtPlugin)!=null?s:new ao(t,{helperRoot:h}),this.metaPlugin=(o=e==null?void 0:e.metaPlugin)!=null?o:new co(t),this.mtoonMaterialPlugin=(l=e==null?void 0:e.mtoonMaterialPlugin)!=null?l:new So(t),this.materialsHDREmissiveMultiplierPlugin=(a=e==null?void 0:e.materialsHDREmissiveMultiplierPlugin)!=null?a:new Lo(t),this.materialsV0CompatPlugin=(u=e==null?void 0:e.materialsV0CompatPlugin)!=null?u:new Uo(t),this.springBonePlugin=(c=e==null?void 0:e.springBonePlugin)!=null?c:new xa(t,{colliderHelperRoot:h,jointHelperRoot:h}),this.nodeConstraintPlugin=(d=e==null?void 0:e.nodeConstraintPlugin)!=null?d:new na(t,{helperRoot:h})}beforeRoot(){return De(this,null,function*(){yield this.materialsV0CompatPlugin.beforeRoot(),yield this.mtoonMaterialPlugin.beforeRoot()})}loadMesh(t){return De(this,null,function*(){return yield this.mtoonMaterialPlugin.loadMesh(t)})}getMaterialType(t){const e=this.mtoonMaterialPlugin.getMaterialType(t);return e??null}extendMaterialParams(t,e){return De(this,null,function*(){yield this.materialsHDREmissiveMultiplierPlugin.extendMaterialParams(t,e),yield this.mtoonMaterialPlugin.extendMaterialParams(t,e)})}afterRoot(t){return De(this,null,function*(){yield this.metaPlugin.afterRoot(t),yield this.humanoidPlugin.afterRoot(t),yield this.expressionPlugin.afterRoot(t),yield this.lookAtPlugin.afterRoot(t),yield this.firstPersonPlugin.afterRoot(t),yield this.springBonePlugin.afterRoot(t),yield this.nodeConstraintPlugin.afterRoot(t),yield this.mtoonMaterialPlugin.afterRoot(t);const e=t.userData.vrmMeta,n=t.userData.vrmHumanoid;if(e&&n){const i=new fo({scene:t.scene,expressionManager:t.userData.vrmExpressionManager,firstPerson:t.userData.vrmFirstPerson,humanoid:n,lookAt:t.userData.vrmLookAt,meta:e,materials:t.userData.vrmMToonMaterials,springBoneManager:t.userData.vrmSpringBoneManager,nodeConstraintManager:t.userData.vrmNodeConstraintManager});t.userData.vrm=i}})}};function Ra(t){const e=new Set;return t.traverse(n=>{if(!n.isMesh)return;const i=n;e.add(i)}),e}function si(t,e,n){if(e.size===1){const o=e.values().next().value;if(o.weight===1)return t[o.index]}const i=new Float32Array(t[0].count*3);let r=0;if(n)r=1;else for(const o of e)r+=o.weight;for(const o of e){const l=t[o.index],a=o.weight/r;for(let u=0;u<l.count;u++)i[u*3+0]+=l.getX(u)*a,i[u*3+1]+=l.getY(u)*a,i[u*3+2]+=l.getZ(u)*a}return new U(i,3)}function wa(t){var e;const n=Ra(t.scene),i=new Map,r=(e=t.expressionManager)==null?void 0:e.expressionMap;if(r!=null)for(const[s,o]of Object.entries(r)){const l=new Set;for(const a of o.binds)if(a instanceof qe){if(a.weight!==0)for(const u of a.primitives){let c=i.get(u);c==null&&(c=new Map,i.set(u,c));let d=c.get(s);d==null&&(d=new Set,c.set(s,d)),d.add(a)}l.add(a)}for(const a of l)o.deleteBind(a)}for(const s of n){const o=i.get(s);if(o==null)continue;const l=s.geometry.morphAttributes;s.geometry.morphAttributes={};const a=s.geometry.clone();s.geometry=a;const u=a.morphTargetsRelative,c=l.position!=null,d=l.normal!=null,h={},f={},p=[];if(c||d){c&&(h.position=[]),d&&(h.normal=[]);let m=0;for(const[g,_]of o)c&&(h.position[m]=si(l.position,_,u)),d&&(h.normal[m]=si(l.normal,_,u)),r==null||r[g].addBind(new qe({index:m,weight:1,primitives:[s]})),f[g]=m,p.push(0),m++}a.morphAttributes=h,s.morphTargetDictionary=f,s.morphTargetInfluences=p}}function Ke(t,e,n){if(t.getComponent)return t.getComponent(e,n);{let i=t.array[e*t.itemSize+n];return t.normalized&&(i=N.denormalize(i,t.array)),i}}function Fi(t,e,n,i){t.setComponent?t.setComponent(e,n,i):(t.normalized&&(i=N.normalize(i,t.array)),t.array[e*t.itemSize+n]=i)}function Ea(t){var e;const n=Sa(t),i=new Set;for(const d of n)i.has(d.geometry)&&(d.geometry=Oa(d.geometry)),i.add(d.geometry);const r=new Map;for(const d of i){const h=d.getAttribute("skinIndex"),f=(e=r.get(h))!=null?e:new Map;r.set(h,f);const p=d.getAttribute("skinWeight"),m=Aa(h,p);f.set(p,m)}const s=new Map;for(const d of n){const h=La(d,r);s.set(d,h)}const o=[];for(const[d,h]of s){let f=!1;for(const p of o)if(Pa(h,p.boneInverseMap)){f=!0,p.meshes.add(d);for(const[g,_]of h)p.boneInverseMap.set(g,_);break}f||o.push({boneInverseMap:h,meshes:new Set([d])})}const l=new Map,a=new mt,u=new mt,c=new mt;for(const d of o){const{boneInverseMap:h,meshes:f}=d,p=Array.from(h.keys()),m=Array.from(h.values()),g=new $e(p,m),_=u.getOrCreate(g);for(const y of f){const T=y.geometry.getAttribute("skinIndex"),M=a.getOrCreate(T),x=y.skeleton.bones,R=x.map(I=>c.getOrCreate(I)).join(","),w=`${M};${_};${R}`;let S=l.get(w);S==null&&(S=T.clone(),ba(S,x,p),l.set(w,S)),y.geometry.setAttribute("skinIndex",S)}for(const y of f)y.bind(g,new F)}}function Sa(t){const e=new Set;return t.traverse(n=>{if(!n.isSkinnedMesh)return;const i=n;e.add(i)}),e}function Aa(t,e){const n=new Set;for(let i=0;i<t.count;i++)for(let r=0;r<t.itemSize;r++){const s=Ke(t,i,r);Ke(e,i,r)!==0&&n.add(s)}return n}function La(t,e){const n=new Map,i=t.skeleton,r=t.geometry,s=r.getAttribute("skinIndex"),o=r.getAttribute("skinWeight"),l=e.get(s),a=l==null?void 0:l.get(o);if(!a)throw new Error("Unreachable. attributeUsedIndexSetMap does not know the skin index attribute or the skin weight attribute.");for(const u of a)n.set(i.bones[u],i.boneInverses[u]);return n}function Pa(t,e){for(const[n,i]of t.entries()){const r=e.get(n);if(r!=null&&!Ia(i,r))return!1}return!0}function ba(t,e,n){const i=new Map;for(const s of e)i.set(s,i.size);const r=new Map;for(const[s,o]of n.entries()){const l=i.get(o);r.set(l,s)}for(let s=0;s<t.count;s++)for(let o=0;o<t.itemSize;o++){const l=Ke(t,s,o),a=r.get(l);Fi(t,s,o,a)}t.needsUpdate=!0}function Ia(t,e,n){if(n=n||1e-4,t.elements.length!=e.elements.length)return!1;for(let i=0,r=t.elements.length;i<r;i++)if(Math.abs(t.elements[i]-e.elements[i])>n)return!1;return!0}var mt=class{constructor(){this._objectIndexMap=new Map,this._index=0}get(t){return this._objectIndexMap.get(t)}getOrCreate(t){let e=this._objectIndexMap.get(t);return e==null&&(e=this._index,this._objectIndexMap.set(t,e),this._index++),e}};function Oa(t){var e,n,i,r;const s=new K;s.name=t.name,s.setIndex(t.index);for(const[o,l]of Object.entries(t.attributes))s.setAttribute(o,l);for(const[o,l]of Object.entries(t.morphAttributes)){const a=o;s.morphAttributes[a]=l.concat()}s.morphTargetsRelative=t.morphTargetsRelative,s.groups=[];for(const o of t.groups)s.addGroup(o.start,o.count,o.materialIndex);return s.boundingSphere=(n=(e=t.boundingSphere)==null?void 0:e.clone())!=null?n:null,s.boundingBox=(r=(i=t.boundingBox)==null?void 0:i.clone())!=null?r:null,s.drawRange.start=t.drawRange.start,s.drawRange.count=t.drawRange.count,s.userData=t.userData,s}function oi(t){if(Object.values(t).forEach(e=>{e!=null&&e.isTexture&&e.dispose()}),t.isShaderMaterial){const e=t.uniforms;e&&Object.values(e).forEach(n=>{const i=n.value;i!=null&&i.isTexture&&i.dispose()})}t.dispose()}function Na(t){const e=t.geometry;e&&e.dispose();const n=t.skeleton;n&&n.dispose();const i=t.material;i&&(Array.isArray(i)?i.forEach(r=>oi(r)):i&&oi(i))}function Ca(t){t.traverse(Na)}function Ua(t,e){var n,i;console.warn("VRMUtils.removeUnnecessaryJoints: removeUnnecessaryJoints is deprecated. Use combineSkeletons instead. combineSkeletons contributes more to the performance improvement. This function will be removed in the next major version.");const r=(n=e==null?void 0:e.experimentalSameBoneCounts)!=null?n:!1,s=[];t.traverse(a=>{a.type==="SkinnedMesh"&&s.push(a)});const o=new Map;let l=0;for(const a of s){const c=a.geometry.getAttribute("skinIndex");if(o.has(c))continue;const d=new Map,h=new Map;for(let f=0;f<c.count;f++)for(let p=0;p<c.itemSize;p++){const m=Ke(c,f,p);let g=d.get(m);g==null&&(g=d.size,d.set(m,g),h.set(g,m)),Fi(c,f,p,g)}c.needsUpdate=!0,o.set(c,h),l=Math.max(l,d.size)}for(const a of s){const c=a.geometry.getAttribute("skinIndex"),d=o.get(c),h=[],f=[],p=r?l:d.size;for(let g=0;g<p;g++){const _=(i=d.get(g))!=null?i:0;h.push(a.skeleton.bones[_]),f.push(a.skeleton.boneInverses[_])}const m=new $e(h,f);a.bind(m,new F)}}function Va(t,e){const n=t.position.count,i=new Array(n);let r=0;const s=e.array;for(let o=0;o<s.length;o++){const l=s[o];i[l]||(i[l]=!0,r++)}return{isVertexUsed:i,vertexCount:n,verticesUsed:r}}function Da(t){const e=[],n=[];let i=0;for(let r=0;r<t.length;r++)if(t[r]){const s=i++;e[r]=s,n[s]=r}return{originalIndexNewIndexMap:e,newIndexOriginalIndexMap:n}}function Fa(t,e){var n,i,r,s;e.name=t.name,e.morphTargetsRelative=t.morphTargetsRelative,t.groups.forEach(o=>{e.addGroup(o.start,o.count,o.materialIndex)}),e.boundingBox=(i=(n=t.boundingBox)==null?void 0:n.clone())!=null?i:null,e.boundingSphere=(s=(r=t.boundingSphere)==null?void 0:r.clone())!=null?s:null,e.setDrawRange(t.drawRange.start,t.drawRange.count),e.userData=t.userData}function Ba(t,e,n){const i=e.array,r=new i.constructor(i.length);for(let s=0;s<i.length;s++){const o=i[s];r[s]=n[o]}t.setIndex(new U(r,e.itemSize,e.normalized))}function Qe(t,e,n){const i=t.constructor,r=new i(e.length*n);let s=!0;for(let o=0;o<e.length;o++){const a=e[o]*n,u=o*n;for(let c=0;c<n;c++){const d=t[a+c];r[u+c]=d,s=s&&d===0}}return[r,s]}function Ha(t){var e;const n=new Map,i=[];for(const[r,s]of Object.entries(t))if(s.isInterleavedBufferAttribute){const o=s,l=o.data,a=(e=n.get(l))!=null?e:[];n.set(l,a),a.push([r,o])}else{const o=s;i.push([r,o])}return[n,i]}function ka(t,e,n){const[i,r]=Ha(e);for(const[s,o]of i){const l=s.array,{stride:a}=s,[u]=Qe(l,n,a),c=new Lt(u,a);c.setUsage(s.usage);for(const[d,h]of o){const{itemSize:f,offset:p,normalized:m}=h,g=new Pt(c,f,p,m);t.setAttribute(d,g)}}for(const[s,o]of r){const l=o.array,{itemSize:a,normalized:u}=o,[c]=Qe(l,n,a);t.setAttribute(s,new U(c,a,u))}}function Wa(t){var e;const n=new Map,i=[];for(const[r,s]of Object.entries(t)){const o=r;for(let l=0;l<s.length;l++){const a=s[l];if(a.isInterleavedBufferAttribute){const u=a,c=u.data,d=(e=n.get(c))!=null?e:[];n.set(c,d),d.push([o,l,u])}else{const u=a;i.push([o,l,u])}}}return[n,i]}function Ga(t,e,n){var i,r;let s=!0;const[o,l]=Wa(e),a={};for(const[u,c]of o){const d=u.array,{stride:h}=u,[f,p]=Qe(d,n,h);s=s&&p;const m=new Lt(f,h);m.setUsage(u.usage);for(const[g,_,y]of c){const{itemSize:T,offset:M,normalized:x}=y,R=new Pt(m,T,M,x);(i=a[g])!=null||(a[g]=[]),a[g][_]=R}}for(const[u,c,d]of l){const h=d,f=h.array,{itemSize:p,normalized:m}=h,[g,_]=Qe(f,n,p);s=s&&_,(r=a[u])!=null||(a[u]=[]),a[u][c]=new U(g,p,m)}t.morphAttributes=s?{}:a}function za(t){const e=new Map;t.traverse(n=>{if(!n.isMesh)return;const i=n,r=i.geometry,s=r.index;if(s==null)return;const o=e.get(r);if(o!=null){i.geometry=o;return}const{isVertexUsed:l,vertexCount:a,verticesUsed:u}=Va(r.attributes,s);if(u===a)return;const{originalIndexNewIndexMap:c,newIndexOriginalIndexMap:d}=Da(l),h=new K;Fa(r,h),e.set(r,h),Ba(h,s,c),ka(h,r.attributes,d),Ga(h,r.morphAttributes,d),i.geometry=h}),Array.from(e.keys()).forEach(n=>{n.dispose()})}function ja(t){var e;((e=t.meta)==null?void 0:e.metaVersion)==="0"&&(t.scene.rotation.y=Math.PI)}var te=class{constructor(){}};te.combineMorphs=wa;te.combineSkeletons=Ea;te.deepDispose=Ca;te.removeUnnecessaryJoints=Ua;te.removeUnnecessaryVertices=za;te.rotateVRM0=ja;/*!
 * @pixiv/three-vrm-core v3.5.1
 * The implementation of core features of VRM, for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-core is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 *//*!
 * @pixiv/three-vrm-materials-mtoon v3.5.1
 * MToon (toon material) module for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-materials-mtoon is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 *//*!
 * @pixiv/three-vrm-materials-hdr-emissive-multiplier v3.5.1
 * Support VRMC_hdr_emissiveMultiplier for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-materials-hdr-emissive-multiplier is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 *//*!
 * @pixiv/three-vrm-materials-v0compat v3.5.1
 * VRM0.0 materials compatibility layer plugin for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-materials-v0compat is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 *//*!
 * @pixiv/three-vrm-node-constraint v3.5.1
 * Node constraint module for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-node-constraint is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 *//*!
 * @pixiv/three-vrm-springbone v3.5.1
 * Spring bone module for @pixiv/three-vrm
 *
 * Copyright (c) 2019-2026 pixiv Inc.
 * @pixiv/three-vrm-springbone is distributed under MIT License
 * https://github.com/pixiv/three-vrm/blob/release/LICENSE
 */const Xa="/observatory/vrm/",qa=["base-female.vrm","base-male.vrm","base-neutral.vrm"];class nl{constructor(){ye(this,"loader");ye(this,"baseModels",[]);ye(this,"instances",new Map);ye(this,"roundRobinIndex",0);this.loader=new es,this.loader.register(e=>new ya(e))}async loadBaseModels(){const e=await Promise.allSettled(qa.map(n=>new Promise((i,r)=>{this.loader.load(Xa+n,s=>{const o=s.userData.vrm;if(!o){r(new Error(`No VRM data in ${n}`));return}te.removeUnnecessaryJoints(s.scene),i(o)},void 0,s=>r(s))})));for(const n of e)n.status==="fulfilled"&&this.baseModels.push(n.value);this.baseModels.length===0?console.warn("[AvatarPool] No VRM base models loaded — will use fallback meshes"):console.info(`[AvatarPool] Loaded ${this.baseModels.length} base VRM model(s)`)}async createInstance(e,n){if(this.baseModels.length===0)return null;const i=this.baseModels[this.roundRobinIndex%this.baseModels.length];this.roundRobinIndex++;const r=i.scene.clone(!0),s={...i,scene:r},o=vn(n),l=new O(o.color),a=new O(o.emissive);return s.scene.traverse(u=>{if(!(u instanceof ue))return;const c=u.material;if(Array.isArray(c))for(const d of c)this.tintMaterial(d,l,a);else c&&this.tintMaterial(c,l,a)}),this.instances.set(e,{vrm:s,mesh:null}),s}releaseInstance(e){const n=this.instances.get(e);n&&(n.vrm&&te.deepDispose(n.vrm.scene),n.mesh&&n.mesh.traverse(i=>{if(i instanceof ue){i.geometry.dispose();const r=i.material;Array.isArray(r)?r.forEach(s=>s.dispose()):r==null||r.dispose()}}),this.instances.delete(e))}getFallbackMesh(e){const n=vn(e),i=new O(n.color),r=new q,s=new Zr(.25,.7,8,16),o=new je({color:i,emissive:new O(n.emissive),emissiveIntensity:.3}),l=new ue(s,o);l.position.y=.6,r.add(l);const a=new $r(.2,16,12),u=new je({color:i,emissive:new O(n.emissive),emissiveIntensity:.4}),c=new ue(a,u);return c.position.y=1.25,r.add(c),r}tintMaterial(e,n,i){"color"in e&&e.color&&e.color.lerp(n,.4),"emissive"in e&&e.emissive&&(e.emissive.copy(i),e.emissiveIntensity=.25)}}export{nl as AvatarPool};
