import {useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {ArrowLeft,Eye,EyeOff,Loader2,TriangleAlert} from 'lucide-react';
import {login,verifyOtp} from './authService';
import type {Session} from '../../types/domain';
import '../../pages/Login.css';

type Step='credentials'|'code';

// The four orbits from the Archon Nell logo, drawn oversized and cropped off the corner.
const ORBITS=[
  {angle:0,color:'var(--orbit-blue)'},
  {angle:45,color:'var(--orbit-green)'},
  {angle:90,color:'var(--orbit-gold)'},
  {angle:135,color:'var(--orbit-red)'},
];

function OrbitMark(){
  return <svg className="login__orbits" viewBox="-400 -400 800 800" aria-hidden="true" focusable="false">
    <g fill="none" strokeWidth="3">
      {ORBITS.map(orbit=><ellipse key={orbit.angle} rx="380" ry="130" transform={`rotate(${orbit.angle})`} stroke={orbit.color}/>)}
    </g>
  </svg>;
}

/** Six punch slots over one real input, so typing, pasting and one-time-code autofill all behave natively. */
function CodeSlots({value,onChange}:{value:string;onChange:(value:string)=>void}){
  const input=useRef<HTMLInputElement>(null);
  return <div className="slots" onClick={()=>input.current?.focus()}>
    <input
      ref={input}
      id="code"
      className="slots__input"
      autoFocus
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      pattern="[0-9]*"
      value={value}
      onChange={event=>onChange(event.target.value.replace(/\D/g,'').slice(0,6))}
      required
    />
    {Array.from({length:6},(_,index)=><span key={index} className={`slot${value[index]?' is-filled':''}${index===value.length?' is-next':''}`} aria-hidden="true">{value[index]??''}</span>)}
  </div>;
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
    <OrbitMark/>

    <header className="login__brand">
      <span className="brand__logo"><img src="/logo.png" alt="Archon Nell Incorporated logo"/></span>
      <span>
        <strong className="brand__name">Archon Nell Incorporated</strong>
        <span className="brand__sub">Payroll &amp; Benefits Management</span>
      </span>
    </header>

    <section className="login__intro">
      <h1>Pay your people on time.</h1>
      <p>Payroll, benefits, claims and HMO for Archon Nell staff, in one place.</p>
    </section>

    <main className="login__main">
      <form className="login__card" onSubmit={submit} noValidate aria-labelledby="signin-title">
        <div className="login__cardhead">
          <span className="login__hole" aria-hidden="true"/>
          <span className="login__step">Step {onCredentials?1:2} of 2</span>
          <span className="login__notches" aria-hidden="true"><i className="is-on"/><i className={onCredentials?'':'is-on'}/></span>
        </div>

        <div className="login__cardbody">
          <h2 id="signin-title" className="login__title">{onCredentials?'Sign in':'Enter your code'}</h2>
          <p className="login__lead">
            {onCredentials
              ?'Enter your employee ID and password. We’ll email you a 6-digit code to confirm it’s you.'
              :'We sent a 6-digit code to the email on your account. It expires in 10 minutes.'}
          </p>

          {onCredentials?<>
            <label className="login__label" htmlFor="employeeId">Employee ID</label>
            <input id="employeeId" className="login__input" autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={employeeId} onChange={e=>setEmployeeId(e.target.value)} required/>
            <label className="login__label" htmlFor="password">Password</label>
            <div className="login__field">
              <input id="password" className="login__input" type={show?'text':'password'} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/>
              <button type="button" className="login__toggle" onClick={()=>setShow(value=>!value)} aria-label={show?'Hide password':'Show password'} aria-pressed={show}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button>
            </div>
          </>:<>
            <p className="login__who">Signing in as <b>{employeeId.trim()}</b></p>
            <label className="login__label" htmlFor="code">Verification code</label>
            <CodeSlots value={code} onChange={setCode}/>
          </>}

          {error&&<p className="login__error" role="alert"><TriangleAlert size={16} aria-hidden="true"/><span>{error}</span></p>}

          <button className="login__submit" disabled={disabled}>
            {loading&&<Loader2 size={17} className="spin" aria-hidden="true"/>}
            {loading?(onCredentials?'Checking…':'Verifying…'):(onCredentials?'Continue':'Verify and sign in')}
          </button>

          {onCredentials
            ?<p className="login__help">Forgot your password? Contact your system administrator.</p>
            :<button type="button" className="login__back" onClick={useDifferentAccount}><ArrowLeft size={15} aria-hidden="true"/>Use a different account</button>}
        </div>
      </form>
    </main>

    <footer className="login__copy">© 2026 Archon Nell Incorporated. All rights reserved.</footer>
  </div>;
}
