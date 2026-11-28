import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

const backend=Deno.env.get('SUPABASE_URL')??'';
const anon=Deno.env.get('SUPABASE_ANON_KEY')??'';
const server=createClient(backend,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false,autoRefreshToken:false}});
const allowedOrigin=Deno.env.get('AVI_ADMIN_ALLOWED_ORIGIN')??'https://avi-salesconnect.netlify.app';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const modules=new Set(['dashboard','leads','customers','opportunities','attendance','field_visits','visit_planner','follow_ups',
  'products','equipment','demonstrations','quotations','orders','tenders','expenses','targets','reports']);

Deno.serve(async request=>{
  const origin=request.headers.get('origin');
  if(origin&&origin!==allowedOrigin)return new Response(null,{status:403});
  const headers={'access-control-allow-origin':allowedOrigin,'access-control-allow-headers':'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods':'POST, PATCH, OPTIONS','content-type':'application/json','cache-control':'no-store',vary:'Origin'};
  const reply=(status:number,result:object)=>new Response(JSON.stringify(result),{status,headers});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const isCreate=request.method==='POST';
  if(!isCreate&&request.method!=='PATCH')return reply(405,{error:'Method unavailable.'});
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!token)return reply(401,{error:'Sign in again.'});
  try {
    const client=createClient(backend,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const user=await client.auth.getUser(token);
    if(user.error||!user.data.user)return reply(401,{error:'Sign in again.'});
    if(Number(request.headers.get('content-length'))>12000)return reply(413,{error:'User request is too large.'});
    const reader=request.body?.getReader();
    if(!reader)return reply(400,{error:'Invalid user request.'});
    const decoder=new TextDecoder();
    let raw='',size=0;
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      size+=part.value.length;
      if(size>12000){await reader.cancel();return reply(413,{error:'User request is too large.'});}
      raw+=decoder.decode(part.value,{stream:true});
    }
    const body=JSON.parse(raw+decoder.decode());
    const organization=String(body.organization??'');
    const member=String(body.id??'');
    const action=isCreate?'create':body.action;
    if(!uuid.test(organization)||!isCreate&&(!uuid.test(member)||!['update','reset','activate','deactivate'].includes(action))) {
      return reply(400,{error:'Invalid user request.'});
    }
    const command=(step:string,authUser:string|null=null,input:object={})=>server.rpc('admin_workspace_staff',{
      p_org:organization,p_actor_user:user.data.user.id,p_action:step,p_member:isCreate?null:member,p_user:authUser,p_input:input,
    });
    const authorized=await command('authorize');
    if(authorized.error)return reply(403,{error:'Administrator access required.'});

    const password=typeof body.password==='string'?body.password:'';
    if((isCreate||action==='reset')&&(password.length<8||password.length>128))return reply(400,{error:'Enter a password of 8 to 128 characters.'});
    const name=String(body.name??'').trim();
    const email=String(body.email??'').trim().toLowerCase();
    const designation=String(body.designation??'').trim();
    const region=String(body.region??'').trim();
    const admin=body.admin===true;
    if((isCreate||action==='update')&&(!name||name.length>200||designation.length>120||region.length>120||
      !Array.isArray(body.modules)||body.modules.length>modules.size||body.modules.some((module:unknown)=>typeof module!=='string'||!modules.has(module)))){
      return reply(400,{error:'Review the user and module details.'});
    }
    const profile={name,designation,region,admin,modules:body.modules};
    let result;
    if(isCreate) {
      if(email.length>254||!emailPattern.test(email))return reply(400,{error:'Enter a valid email address.'});
      const created=await server.auth.admin.createUser({email,password,email_confirm:true});
      if(created.error||!created.data.user)return reply(409,{error:'Could not create the sign-in. Verify that the email is available.'});
      const authUser=created.data.user.id;
      result=await command('create',authUser,profile);
      if(result.error)await server.auth.admin.deleteUser(authUser);
    } else if(action==='reset') {
      const reset={reset_key:crypto.randomUUID()};
      const prepared=await command('prepare_reset',null,reset);
      if(prepared.error)return reply(400,{error:prepared.error.message});
      const changed=await server.auth.admin.updateUserById(prepared.data.auth_user,{password});
      if(changed.error)return reply(409,{error:'The password service could not confirm this reset. Retry in three minutes.'});
      result=await command('finish_reset',null,reset);
    } else result=await command(action,null,action==='update'?profile:{});
    if(result.error)return reply(result.error.code==='42501'?403:result.error.code==='PT404'?404:400,
      {error:['42501','PT404','22023'].includes(result.error.code)?result.error.message:'Unable to save the user. Refresh and try again.'});
    return reply(isCreate?201:200,{id:result.data.id});
  } catch {
    return reply(400,{error:'Unable to process the user request. Refresh and try again.'});
  }
});
