#!/usr/bin/env python3
"""Execute unchanged prerequisite regressions from canonical pinned Git objects."""
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from every8dSettingsSessionConsumptionConcurrency import Failure

ROOT=Path(__file__).resolve().parents[2]
BASE='0817596034b69c1badca2fdac1bf56b0490e4a3d'
PROOFS=('ghlSmsOutboundClaimConcurrency','ghlSmsControlledLiveAuthorizationConcurrency','ghlMarketplaceOwnership','ghlMarketplaceLifecycleOrdering','ghlPublicOAuthBootstrap','ghlOAuthRefreshFoundation','every8dProviderConfigurations','every8dSettingsAuthFoundation','every8dSettingsEmailChallengeFoundation','every8dSettingsAuthOrchestration','every8dSettingsSessionConsumption')

def run():
    binary=shutil.which(os.environ.get('GIT_BIN','git'))
    if not binary:raise Failure('canonical regression Git binary unavailable')
    container='c3c3-regression-'+uuid.uuid4().hex[:12]
    def invoke(cmd,data=None,cwd=ROOT,env=None,seconds=60):
        try:result=subprocess.run(cmd,input=data,capture_output=True,cwd=cwd,env=env,timeout=seconds)
        except subprocess.TimeoutExpired as exc:raise Failure('unchanged regression process timeout') from exc
        if result.returncode:
            state=re.search(rb'ERROR:\s+([0-9A-Z]{5})\b',result.stderr)
            raise Failure('unchanged regression invocation failed: '+(state[1].decode() if state else 'nonzero process status'))
        return result.stdout
    def sql(statement,db='wincrm_test'):
        return invoke(['docker','exec','-i',container,'psql','-X','-Atq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','postgres','-d',db],statement.encode())
    started=False
    try:
        invoke(['docker','run','-d','--name',container,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=wincrm_test','postgres:17-bookworm','postgres','-c','log_min_error_statement=panic','-c','log_error_verbosity=terse']);started=True
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            result=subprocess.run(['docker','exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','wincrm_test'],capture_output=True,timeout=5)
            if result.returncode==0:break
            time.sleep(.1)
        else:raise Failure('unchanged regression PG17 startup timeout')
        if sql("select current_setting('server_version_num')::int/10000=17").strip()!=b't':raise Failure('regressions require PG17')
        with tempfile.TemporaryDirectory(prefix='c3c3-regression-') as temporary:
            target=Path(temporary)
            paths=invoke([binary,'ls-tree','-r','--name-only',BASE,'supabase','test/postgres']).decode().splitlines()
            for relative in paths:
                if not relative.endswith(('.sql','.sh','.py','.json')):continue
                file=target/relative;file.parent.mkdir(parents=True,exist_ok=True)
                file.write_bytes(invoke([binary,'show',BASE+':'+relative]))
            git_root=invoke([binary,'rev-parse','--show-toplevel']).decode().strip()
            tools=target/'bin';tools.mkdir()
            shim=tools/'git';shim.write_text('#!/bin/sh\nexec '+shlex.quote(binary)+' -C '+shlex.quote(git_root)+' "$@"\n');shim.chmod(0o700)
            env=dict(os.environ,POSTGRES_CONTAINER_ID=container,PATH=str(tools)+os.pathsep+os.environ['PATH'])
            sql('create role anon nologin;create role authenticated nologin;create role service_role nologin;')
            omitted=('202609230002','202609270001','202609300001','202610020001','202610060001','202610140001','202610220001')
            for migration in sorted((target/'supabase/migrations').glob('*.sql')):
                if migration.name.startswith(omitted):continue
                sql(migration.read_bytes().decode())
            for proof in PROOFS:
                try:invoke(['bash','test/postgres/'+proof+'.sh'],cwd=target,env=env,seconds=300)
                except Failure as exc:raise Failure('regression '+proof+': '+str(exc)) from exc
                print('PASS regression '+proof,flush=True)
            result=sql("select (select count(*)=0 from pg_database where datname not in ('postgres','template0','template1','wincrm_test')) and (select count(*)=0 from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid())",'postgres').strip()
            if result!=b't':raise Failure('regression databases/backends survived')
    finally:
        if started:invoke(['docker','rm','-f','-v',container])
    names=invoke(['docker','ps','-aq','--filter','name='+container]).strip()
    if names:raise Failure('regression container survived')
    print('PASS all 11 unchanged DB regressions; zero surviving regression resources',flush=True)

if __name__=='__main__':run()
