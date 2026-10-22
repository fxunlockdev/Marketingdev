import {isIP} from 'node:net';
export function listenAddress(env=process.env){
 const raw=env.PORT??'3100',port=Number(raw),host=env.LISTEN_HOST??(['staging','production'].includes(env.APP_MODE??'')?'::':'127.0.0.1');
 if(!/^\d+$/.test(raw)||!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer from 1 to 65535');
 if(!isIP(host))throw new Error('LISTEN_HOST must be an IP address');
 return {port,host};
}
