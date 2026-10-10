import {useState} from 'react';
import type {FormEvent} from 'react';
import {ArrowLeft,Eye,EyeOff,Loader2,TriangleAlert} from 'lucide-react';
import {login,verifyOtp} from './authService';
import type {Session} from '../../types/domain';
import '../../pages/Login.css';

type Step='credentials'|'code';

// The four orbits from the Archon Nell logo, drawn as a site plan.
const ORBITS=[
  {angle:0,color:'var(--orbit-blue)'},
  {angle:45,color:'var(--orbit-green)'},
  {angle:90,color:'var(--orbit-gold)'},
  {angle:135,color:'var(--orbit-red)'},
];

function SiteDrawing(){
  return <svg className="drawing" viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <pattern id="drawing-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" strokeWidth="1"/></pattern>
    </defs>
    <rect className="drawing__grid" width="800" height="900" fill="url(#drawing-grid)"/>
    <g className="drawing__centreline"><line x1="0" y1="430" x2="800" y2="430"/><line x1="470" y1="0" x2="470" y2="900"/></g>
    <g className="drawing__ring"><circle cx="470" cy="430" r="96"/><circle cx="470" cy="430" r="204"/></g>
    <g transform="translate(470 430)">
      {ORBITS.map((orbit,index)=><ellipse key={orbit.angle} className="drawing__orbit" rx="340" ry="116" pathLength={1} transform={`rotate(${orbit.angle})`} style={{stroke:orbit.color,animationDelay:`${0.2+index*0.18}s`}}/>)}
      <circle className="drawing__node-ring" r="14"/>
      <circle className="drawing__node" r="6"/>
    </g>
  </svg>;
}

export default function Login({onSignedIn}:{onSignedIn:(s:Session)=>void}){
  const[employeeId,setEmployeeId]=useState('');
  const[password,setPassword]=useState('');
  const[code,setCode]=useState('');
  const[challengeId,setChallengeId]=useState('');
  const[step,setStep]=useState<Step>('credentials');
  const[show,setShow]=useState(false);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState('');

  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    setError('');
    setLoading(true);
    try{
      if(step==='credentials'){
        const challenge=await login(employeeId.trim(),password);
        setChallengeId(challenge.challenge_id??'dev-challenge');
        setStep('code');
      }else{
        onSignedIn(await verifyOtp(employeeId.trim(),code.trim(),challengeId||'dev-challenge'));
      }
    }catch(err){
      setError(err instanceof Error?err.message:'Unable to sign in');
    }finally{
      setLoading(false);
    }
  };

  const useDifferentAccount=()=>{
    setStep('credentials');
    setCode('');
    setChallengeId('');
    setPassword('');
    setError('');
  };

  const onCredentials=step==='credentials';
  const disabled=loading||(onCredentials?(!employeeId.trim()||!password):code.length!==6);

  return <div className="login">
    <aside className="login__brand">
      <SiteDrawing/>
      <div className="login__ruler" aria-hidden="true"/>
      <div className="brand">
        <span className="brand__logo"><img src="/logo.png" alt="Archon Nell Incorporated logo"/></span>
        <span>
          <strong className="brand__name">Archon Nell Incorporated</strong>
          <span className="brand__sub">Payroll &amp; Benefits Management</span>
        </span>
      </div>
      <div className="login__pitch"><h1>Run payroll, benefits and claims for the whole team.</h1></div>
      <small className="login__copy">© 2026 Archon Nell Incorporated. All rights reserved.</small>
    </aside>

    <main className="login__panel">
      <form className="signin" onSubmit={submit} noValidate aria-labelledby="signin-title">
        <div className="signin__progress">
          <span className="signin__bars" aria-hidden="true"><i className="is-on"/><i className={onCredentials?'':'is-on'}/></span>
          <span>Step {onCredentials?1:2} of 2</span>
        </div>
        <h2 id="signin-title" className="signin__title">{onCredentials?'Sign in':'Enter your code'}</h2>
        <p className="signin__lead">
          {onCredentials
            ?'Use your employee ID and password. We’ll email you a 6-digit code to confirm it’s you.'
            :'We emailed a 6-digit code to the address on your account. It expires in 10 minutes.'}
        </p>

        {onCredentials?<>
          <label className="signin__label" htmlFor="employeeId">Employee ID</label>
          <input id="employeeId" className="signin__input" autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={employeeId} onChange={e=>setEmployeeId(e.target.value)} required/>
          <label className="signin__label" htmlFor="password">Password</label>
          <div className="signin__field">
            <input id="password" className="signin__input" type={show?'text':'password'} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/>
            <button type="button" className="signin__toggle" onClick={()=>setShow(value=>!value)} aria-label={show?'Hide password':'Show password'} aria-pressed={show}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button>
          </div>
        </>:<>
          <p className="signin__who">Signing in as <b>{employeeId.trim()}</b></p>
          <label className="signin__label" htmlFor="code">Verification code</label>
          <input id="code" className="signin__input signin__input--code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} required/>
        </>}

        {error&&<p className="signin__error" role="alert"><TriangleAlert size={16} aria-hidden="true"/><span>{error}</span></p>}

        <button className="signin__submit" disabled={disabled}>
          {loading&&<Loader2 size={17} className="spin" aria-hidden="true"/>}
          {loading?(onCredentials?'Checking…':'Verifying…'):(onCredentials?'Continue':'Verify and sign in')}
        </button>

        {onCredentials
          ?<p className="signin__help">Locked out or forgot your password? Contact your system administrator.</p>
          :<button type="button" className="signin__back" onClick={useDifferentAccount}><ArrowLeft size={15} aria-hidden="true"/>Use a different account</button>}
      </form>
    </main>
  </div>;
}
