export function mailConfig(env:NodeJS.ProcessEnv,mode:string){
 const required=(key:string)=>{if(!env[key])throw new Error(`${key} is required`);return env[key]!;};
 const provider=env.MAIL_PROVIDER??'smtp';
 if(!['smtp','resend'].includes(provider))throw new Error('MAIL_PROVIDER must be smtp or resend');
 // Resend officially supports implicit TLS SMTP with the API key as password.
 // Fixed transport settings prevent unrelated SMTP variables redirecting this key.
 const smtp=provider==='resend'
  ?{host:'smtp.resend.com',port:465,secure:true,user:'resend',password:required('RESEND_API_KEY'),from:required('RESEND_FROM')}
  :{host:required('SMTP_HOST'),port:Number(required('SMTP_PORT')),secure:env.SMTP_SECURE==='true',user:env.SMTP_USER,password:env.SMTP_PASSWORD,from:required('SMTP_FROM')};
 if(!Number.isInteger(smtp.port)||smtp.port<1||smtp.port>65535)throw new Error('Invalid SMTP port');
 if(provider==='smtp'&&env.SMTP_SECURE!==undefined&&!['true','false'].includes(env.SMTP_SECURE))throw new Error('SMTP_SECURE must be true or false');
 if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(smtp.from))throw new Error('Email sender must be a single email address');
 if(mode==='staging'&&(!smtp.user||!smtp.password))throw new Error('Authenticated SMTP required for staging');
 return smtp;
}
