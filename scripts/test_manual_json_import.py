import contextlib
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import local_fallback as fallback
import manual_json_import as importer
from options_revisions import OptionsRevisions
from sync_direct import normalize

NOW = datetime(2026, 10, 14, 17, 0, tzinfo=timezone.utc)
FIXTURE = Path(__file__).parent / 'fixtures/manual-news.json'


def stamp(minutes):
    return (NOW + timedelta(minutes=minutes)).isoformat()


def option(ticker='SPY', age=-5, gamma=-5):
    return dict(symbol=ticker, referencePrice=100, nearestExpiry='2026-10-16', maxPain=101,
                putCallRatioVolume=1.2, putCallRatioOpenInterest=1.3, volume=1200,
                callWall=110, putWall=90, gammaFlip=102, gammaPer1Pct=123456,
                netGammaExposure=987654, volumeShare={'call':40,'put':60},
                openInterestShare={'call':30,'put':70}, premiumShare={'call':60,'put':40},
                snapshotUpdatedAt=stamp(age), asOf=stamp(age-1), gammaUpdatedAt=stamp(gamma),
                optionVolumeVsAvg={'windows':{'d3':{'available':True,'ratioPct':150}}},
                untouchedExtra={'complete':'raw payload retained only in private archive'})


def cache(raw=None, fetched=-30):
    raw = raw or option(age=-60, gamma=-60)
    payload = normalize(raw, raw['symbol'])
    payload['fetchedAt'] = stamp(fetched)
    return dict(ticker=raw['symbol'], payload=payload, source_updated_at=payload['sourceUpdatedAt'],
                fetched_at=stamp(fetched), last_attempted_at=stamp(fetched), refresh_started_at=None)


class MemoryDB:
    def __init__(self, rows=()):
        self.options = {row['ticker']:deepcopy(row) for row in rows}
        self.news = {}
        self.writes = []
        self.reads = 0
        self.before_read = None
        self.before_save = None
        self.before_insert_news = None

    def options_row(self, ticker):
        self.reads += 1
        if self.before_read:
            self.before_read(self)
        return deepcopy(self.options.get(ticker))

    def save_options(self, ticker, incoming, previous):
        if self.before_save:
            self.before_save(self)
        if self.options.get(ticker) != previous:
            return []
        row = deepcopy(previous) if previous else dict(ticker=ticker, last_attempted_at=None, refresh_started_at=None)
        row.update(payload=dict(incoming),source_updated_at=incoming['sourceUpdatedAt'],fetched_at=incoming['fetchedAt'])
        self.options[ticker] = row
        self.writes.append(ticker)
        return [{'ticker':ticker}]

    def existing_news_ids(self, source, ids):
        return {i for i in ids if (source,i) in self.news}

    def insert_news(self, rows):
        if self.before_insert_news:
            self.before_insert_news(self, rows)
        inserted = []
        for row in rows:
            key = (row['source'],row['external_id'])
            if key not in self.news:
                self.news[key] = deepcopy(row)
                inserted.append({'id':str(len(self.news))})
                self.writes.append(key)
        return inserted


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.revisions = OptionsRevisions(self.root/'revisions.json')
        self.tickers = fallback.allowed_tickers()
        clock = patch.object(importer,'utcnow',return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)

    def prepared(self, raw=None):
        return importer.prepare(raw or option(), 'Input 1', self.tickers, NOW)

    def cli(self, text, db=None, args=()):
        db = db or MemoryDB()
        output = io.StringIO()
        with patch.object(fallback,'Database',return_value=db), \
             patch.object(fallback,'load_credentials',return_value={}) as credentials, \
             patch.object(fallback,'single_run',contextlib.nullcontext), \
             patch.object(importer,'OptionsRevisions',return_value=self.revisions), \
             patch.object(importer,'ARCHIVE',self.root/'archives'):
            code = importer.main(list(args),stdin=io.StringIO(text),stdout=output)
        return code, output.getvalue(), credentials

    def test_all_19_tickers_use_existing_normalization(self):
        self.assertEqual(len(self.tickers),19)
        for ticker in self.tickers:
            with self.subTest(ticker=ticker):
                raw=option(ticker)
                prepared=self.prepared(raw)
                expected=normalize(raw,ticker)
                expected['fetchedAt']=NOW.isoformat()
                self.assertEqual(prepared.payload,expected)
                self.assertEqual(prepared.payload.gamma_updated_at,raw['gammaUpdatedAt'])
                db=MemoryDB()
                report=importer.import_options(prepared,db,self.revisions)
                self.assertEqual(report.inserted,1)
                self.assertEqual(db.options[ticker]['payload'],expected)
                self.assertEqual(self.revisions.matching_gamma(db.options[ticker]),raw['gammaUpdatedAt'])

    def test_newer_source_updates_stale_cache(self):
        db=MemoryDB([cache()])
        report=importer.import_options(self.prepared(),db,self.revisions)
        self.assertEqual((report.updated,report.errors),(1,0))
        self.assertEqual(db.options['SPY']['payload']['sourceUpdatedAt'],stamp(-5))

    def test_fresh_manual_payload_and_table_are_preserved(self):
        for field in ('payload','table'):
            old=cache()
            if field=='payload': old['payload']['fetchedAt']=stamp(-1)
            else: old['fetched_at']=stamp(-1)
            db=MemoryDB([old])
            report=importer.import_options(self.prepared(),db,self.revisions)
            self.assertEqual(report.skipped,1)
            self.assertEqual(db.options['SPY'],old)
            self.assertEqual(db.writes,[])

    def test_equal_older_and_regressing_asof_are_skipped(self):
        for raw in (option(age=-60,gamma=-60), option(age=-70), {**option(),'asOf':stamp(-90)}):
            db=MemoryDB([cache()])
            report=importer.import_options(self.prepared(raw),db,self.revisions)
            self.assertEqual(report.skipped,1)
            self.assertEqual(db.writes,[])

    def test_unknown_manual_timestamps_and_active_gate_are_preserved(self):
        for key,value in [('source_updated_at','invalid'),('refresh_started_at',stamp(-1))]:
            old=cache();old[key]=value
            db=MemoryDB([old])
            report=importer.import_options(self.prepared(),db,self.revisions)
            self.assertEqual(report.skipped,1)
            self.assertEqual(db.options['SPY'],old)

    def test_newer_gamma_at_equal_snapshot_updates_with_provenance(self):
        old=cache()
        self.revisions.remember(old,self.prepared(option(age=-60,gamma=-60)).payload)
        raw=option(age=-60,gamma=-5);raw['gammaPer1Pct']=777
        db=MemoryDB([old])
        report=importer.import_options(self.prepared(raw),db,self.revisions)
        self.assertEqual(report.updated,1)
        self.assertEqual(db.options['SPY']['payload']['netGex'],777)

    def test_manual_gamma_edit_invalidates_provenance(self):
        old=cache()
        self.revisions.remember(old,self.prepared(option(age=-60,gamma=-60)).payload)
        old['payload']['netGex']=999
        db=MemoryDB([old])
        raw=option(age=-60,gamma=-5);raw['gammaPer1Pct']=777
        report=importer.import_options(self.prepared(raw),db,self.revisions)
        self.assertEqual(report.skipped,1)
        self.assertIn('edited outside',report.detail)
        self.assertEqual(db.options['SPY'],old)

    def test_manual_gamma_observation_cannot_be_regressed(self):
        db=MemoryDB([cache()])
        raw=option(gamma=-35);raw['gammaPer1Pct']=777
        report=importer.import_options(self.prepared(raw),db,self.revisions)
        self.assertEqual(report.skipped,1)
        self.assertEqual(db.writes,[])

    def test_concurrent_edit_between_reads_or_during_write_wins(self):
        for phase in ('read','write'):
            db=MemoryDB([cache()])
            def edit(db):
                db.options['SPY']['payload']['fetchedAt']=stamp(-1)
                db.options['SPY']['payload']['maxPain']=999
            if phase=='read': db.before_read=lambda db:edit(db) if db.reads==2 else None
            else: db.before_save=edit
            report=importer.import_options(self.prepared(),db,self.revisions)
            self.assertEqual(report.skipped,1)
            self.assertEqual(db.options['SPY']['payload']['maxPain'],999)
            self.assertEqual(db.writes,[])

    def test_concurrent_insert_wins(self):
        db=MemoryDB()
        db.before_save=lambda db:db.options.update(SPY=cache(fetched=-1))
        report=importer.import_options(self.prepared(),db,self.revisions)
        self.assertEqual(report.skipped,1)
        self.assertEqual(db.writes,[])

    def test_write_readback_failure_is_reported_without_retry(self):
        db=MemoryDB([cache()])
        def fail(db):
            if db.reads==3: raise fallback.SafeError('read failed')
        db.before_read=fail
        report=importer.import_options(self.prepared(),db,self.revisions)
        self.assertEqual((report.updated,report.errors),(1,1))
        self.assertEqual(db.writes,['SPY'])

    def test_news_translations_dates_ids_tickers_and_both_feeds(self):
        docs=importer.decode(FIXTURE.read_text())
        first=importer.prepare(docs[0],'Input 1',self.tickers,NOW)
        row=first.rows[0]
        self.assertEqual(row['title'],'Fixture: markets & earnings')
        self.assertEqual(row['published_at'],'2026-10-14T15:59:00Z')
        self.assertEqual(row['external_id'],'fixture-reuters-1')
        self.assertEqual(row['tickers'],['SPY','QQQ'])
        db=MemoryDB()
        reports=[importer.import_news(importer.prepare(d,'Input',self.tickers,NOW),db) for d in docs]
        self.assertEqual(sum(r.inserted for r in reports),3)
        self.assertEqual(sum(r.skipped for r in reports),4)
        self.assertEqual({s for s,_ in db.news},{'Reuters','Financial Juice'})
        self.assertEqual(db.news[('Reuters','fixture-reuters-1')],row)

    def test_existing_news_and_concurrent_manual_news_never_change(self):
        first=importer.prepare(importer.decode(FIXTURE.read_text())[0],'Input',self.tickers,NOW)
        db=MemoryDB()
        manual={'title':'manual value','published_at':stamp(0)}
        db.news[('Reuters','fixture-reuters-1')]=deepcopy(manual)
        db.before_insert_news=lambda db,rows:db.news.update({(r['source'],r['external_id']):deepcopy(manual) for r in rows})
        report=importer.import_news(first,db)
        self.assertEqual(report.inserted,0)
        self.assertTrue(all(row==manual for row in db.news.values()))

    def test_invalid_and_future_news_rows_do_not_write(self):
        raw={'news_list':[None,{}, {'id':'future','source':'reuters','title':'Future','created_at':stamp(30)}]}
        db=MemoryDB()
        report=importer.import_news(self.prepared(raw),db)
        self.assertEqual(report.skipped,3)
        self.assertEqual(db.writes,[])

    def test_dry_run_has_no_writes_archives_or_revision_updates(self):
        db=MemoryDB([cache()])
        text=json.dumps([option(),*importer.decode(FIXTURE.read_text())])
        code,output,_=self.cli(text,db,args=['--dry-run'])
        self.assertEqual(code,0)
        self.assertIn('would_update=1',output)
        self.assertEqual(db.writes,[])
        self.assertFalse((self.root/'archives').exists())
        self.assertFalse(self.revisions.path.exists())

    def test_validate_only_never_reads_credentials_or_database(self):
        with patch.object(fallback,'Database',side_effect=AssertionError('DB forbidden')):
            output=io.StringIO()
            with patch.object(fallback,'load_credentials') as credentials:
                code=importer.main(['--validate-only'],stdin=io.StringIO(json.dumps(option())),stdout=output)
            credentials.assert_not_called()
        self.assertEqual(code,0)
        self.assertIn('no database access',output.getvalue())

    def test_complete_raw_payload_archived_privately_with_public_schema_unchanged(self):
        raw=option()
        text=json.dumps(raw,indent=2)
        db=MemoryDB()
        code,output,_=self.cli(text,db)
        self.assertEqual(code,0)
        archived=list((self.root/'archives').glob('*.json'))
        self.assertEqual(len(archived),1)
        self.assertEqual(archived[0].read_text(),text)
        self.assertNotIn('untouchedExtra',db.options['SPY']['payload'])
        self.assertNotIn(raw['untouchedExtra']['complete'],output)
        if os.name=='posix':
            self.assertEqual(archived[0].stat().st_mode & 0o777,0o600)
            self.assertEqual(archived[0].parent.stat().st_mode & 0o777,0o700)

    def test_batch_orders_newest_first_for_duplicate_ticker(self):
        db=MemoryDB()
        code,output,_=self.cli(json.dumps([option(age=-60,gamma=-60),option()]),db)
        self.assertEqual(code,0)
        self.assertEqual(db.options['SPY']['payload']['sourceUpdatedAt'],stamp(-5))
        self.assertEqual(db.writes,['SPY'])
        self.assertIn('skipped=1',output)

    def test_batch_files_continue_after_bad_file_and_do_not_print_contents(self):
        valid=self.root/'valid.json';valid.write_text(json.dumps(option()))
        invalid=self.root/'bad.json';invalid.write_text('{"secret":"do-not-print"')
        db=MemoryDB()
        code,output,_=self.cli('',db,args=[str(invalid),str(valid)])
        self.assertEqual(code,1)
        self.assertEqual(db.writes,['SPY'])
        self.assertNotIn('do-not-print',output)

    def test_invalid_member_rejects_whole_array_before_writes(self):
        db=MemoryDB()
        code,_,credentials=self.cli(json.dumps([option(),{'symbol':'UNSUPPORTED'}]),db)
        self.assertEqual(code,1)
        credentials.assert_not_called()
        self.assertEqual(db.writes,[])

    def test_malformed_ambiguous_nonfinite_and_duplicate_input_rejected(self):
        for text in ('{"symbol":"SPY","symbol":"QQQ"}','{"x":NaN}','{"x":1e999}','[]','[1]', '{}{}'):
            with self.subTest(text=text),self.assertRaises(fallback.SafeError):
                importer.decode(text)
        for raw in ({'news_list':{}},{'news_list':[],'symbol':'SPY'},option('BAD'),{**option(),'gammaUpdatedAt':'invalid'},
                    {**option(),'snapshotUpdatedAt':stamp(10)}, {**option(),'asOf':None}):
            with self.subTest(raw=raw),self.assertRaises(fallback.SafeError):
                self.prepared(raw)

    def test_size_limit_and_multiline_finish(self):
        class Terminal(io.StringIO):
            def isatty(self): return True
        text=json.dumps(option(),indent=2)+'\n'
        output=io.StringIO()
        with patch.object(importer,'paste_mode',contextlib.nullcontext):
            self.assertEqual(importer.read_input(Terminal(text+'END\n'),output),text)
            with self.assertRaises(fallback.SafeError):
                importer.read_input(Terminal(text),output)
        self.assertIn('END on its own line',output.getvalue())
        with patch.object(importer,'MAX_BYTES',10):
            with self.assertRaises(fallback.SafeError): importer.decode(' '*11)

    def test_no_browser_fetch_from_any_import_path(self):
        with patch.object(fallback,'fetch_options',side_effect=AssertionError('fetch forbidden')), \
             patch.object(fallback,'fetch_news_payloads',side_effect=AssertionError('fetch forbidden')), \
             patch.object(fallback,'request_json',side_effect=AssertionError('network forbidden')):
            code,_,_=self.cli(json.dumps([option(),*importer.decode(FIXTURE.read_text())]))
        self.assertEqual(code,0)

    def test_manual_import_does_not_depend_on_options_fetch_hours(self):
        with patch.object(fallback,'within_options_refresh_window',side_effect=AssertionError('fetch schedule untouched')):
            code,_,_=self.cli(json.dumps(option()))
        self.assertEqual(code,0)

    def test_sql_write_contract_is_original_cas_and_ignore_duplicates(self):
        db=fallback.Database({'PROJECT_URL':'https://example.test','SERVICE_ROLE_KEY':'synthetic'})
        with patch.object(db,'request',return_value=[{'ticker':'SPY'}]) as request:
            previous=cache()
            db.save_options('SPY',self.prepared().payload,previous)
            query=request.call_args.args[1]
            self.assertEqual(json.loads(query['payload'][3:]),previous['payload'])
            for field in ('source_updated_at','fetched_at','last_attempted_at','refresh_started_at'):
                self.assertIn(field,query)
            self.assertEqual(request.call_args.kwargs['method'],'PATCH')
            db.insert_news([{}])
            self.assertIn('ignore-duplicates',request.call_args.kwargs['prefer'])
            self.assertEqual(request.call_args.kwargs['method'],'POST')


    def test_dry_run_batch_deduplicates_news_and_options(self):
        db=MemoryDB([cache()])
        text=json.dumps([option(age=-60,gamma=-60),option(),*importer.decode(FIXTURE.read_text())])
        code,output,_=self.cli(text,db,args=['--dry-run'])
        self.assertEqual(code,0)
        total=output.splitlines()[-1]
        self.assertIn('would_insert=3',total)
        self.assertIn('would_update=1',total)
        self.assertEqual(db.writes,[])

    def test_json_errors_include_line_column_without_input_values(self):
        cases=[
            ('{\n  "news_list": []\n  "secret": "not-for-reports"\n}',3,3,"Expecting ',' delimiter"),
            ('{\n  "news_list": [\n}',3,1,'Expecting value'),
            ('{\n "secret-key": "not-for-reports",\n "secret-key": 2\n}',3,2,'Duplicate object key'),
            ('{\n "x": NaN\n}',2,7,'Non-finite number'),
            ('{\n "x": Infinity\n}',2,7,'Non-finite number'),
            ('{\n "x": -Infinity\n}',2,7,'Non-finite number'),
            ('{\n "x": 1e999\n}',2,7,'Non-finite number'),
        ]
        for text,line,column,reason in cases:
            with self.subTest(reason=reason,text=text):
                with self.assertRaises(fallback.SafeError) as caught:
                    importer.decode(text)
                message=str(caught.exception)
                self.assertIn(f'line {line}, column {column}',message)
                self.assertIn(reason,message)
                self.assertNotIn('not-for-reports',message)
                self.assertNotIn('secret-key',message)
                code,output,credentials=self.cli(text)
                self.assertEqual(code,1)
                self.assertIn(f'line {line}, column {column}',output)
                self.assertNotIn('not-for-reports',output)
                credentials.assert_not_called()

    def test_duplicate_location_respects_nested_objects_strings_and_escaped_keys(self):
        text=r'{"outer": [{"key": "NaN, {not a key}", "k\u0065y": 2}]}'
        with self.assertRaises(fallback.SafeError) as caught:
            importer.decode(text)
        position=text.index('"k'+chr(92))+1
        self.assertIn(f'line 1, column {position}',str(caught.exception))
        self.assertEqual(importer.decode('{"left":{"key":1},"right":{"key":2},"string":"NaN Infinity 1e999"}')[0]['right'],{'key':2})

    def test_terminal_confirmation_precedes_database_and_archives(self):
        class Terminal(io.StringIO):
            def isatty(self): return True
        for raw in (option(),importer.decode(FIXTURE.read_text())[0]):
            for answer,expected in (('yes',1),('y',1),('no',0),('',0)):
                with self.subTest(news='news_list' in raw,answer=answer):
                    output=io.StringIO();db=MemoryDB()
                    stream=Terminal(json.dumps(raw,indent=2)+'\nEND\n'+answer+'\n')
                    with patch.object(importer,'paste_mode',contextlib.nullcontext), \
                         patch.object(fallback,'single_run',contextlib.nullcontext), \
                         patch.object(fallback,'load_credentials',return_value={}) as credentials, \
                         patch.object(fallback,'Database',return_value=db), \
                         patch.object(importer,'OptionsRevisions',return_value=self.revisions), \
                         patch.object(importer,'archive') as archive:
                        code=importer.main([],stdin=stream,stdout=output)
                    self.assertEqual(code,0)
                    self.assertEqual(credentials.call_count,expected)
                    self.assertEqual(archive.call_count,expected)
                    self.assertIn('JSON validation PASSED',output.getvalue())
                    if 'news_list' in raw:
                        self.assertIn('4 articles received',output.getvalue())
                        self.assertIn('Reuters / Financial Juice News feed',output.getvalue())
                    else:
                        self.assertIn('detected ticker SPY',output.getvalue())
                    if not expected: self.assertEqual(db.writes,[])

    @unittest.skipUnless(os.name=='posix','PTY regression requires POSIX')
    def test_terminal_accepts_visible_large_pastes_and_restores_settings(self):
        import pty
        import select
        import signal
        import termios
        import threading
        import time
        cases=[('long',json.dumps({'news_list':[], 'unused':'x'*150000}),False),
               ('multiline',FIXTURE.read_text(),False),
               ('cancel','',True)]
        for name,text,cancel in cases:
            with self.subTest(case=name):
                master,slave=pty.openpty()
                before=termios.tcgetattr(slave)
                process=subprocess.Popen([sys.executable,'-B',str(Path(importer.__file__)),'--validate-only'],
                                         stdin=slave,stdout=slave,stderr=slave)
                output=bytearray()
                writer=None
                def drain_until(condition):
                    end=time.monotonic()+15
                    while not condition():
                        if time.monotonic()>end: self.fail('Terminal fixture timed out')
                        if select.select([master],[],[],.05)[0]: output.extend(os.read(master,65536))
                try:
                    drain_until(lambda:b'Ctrl-C cancels before any import.' in output)
                    self.assertIn(b'Input is visible.',output)
                    if cancel:
                        process.send_signal(signal.SIGINT)
                    else:
                        data=(text+'\nEND\n').encode()
                        def write_paste():
                            remaining=memoryview(data)
                            while remaining:
                                remaining=remaining[os.write(master,remaining[:4096]):]
                        # Drain echo while writing; a real Terminal does this too.
                        writer=threading.Thread(target=write_paste,daemon=True)
                        writer.start()
                    drain_until(lambda:process.poll() is not None)
                    while select.select([master],[],[],.05)[0]: output.extend(os.read(master,65536))
                    if writer:
                        writer.join(timeout=1)
                        self.assertFalse(writer.is_alive())
                    self.assertEqual(process.returncode,130 if cancel else 0)
                    after=termios.tcgetattr(slave)
                    # macOS sets PENDIN itself when canonical mode is restored.
                    for settings in (before,after):
                        settings[3] &= ~getattr(termios,'PENDIN',0)
                    self.assertEqual(after,before)
                    if not cancel:
                        self.assertIn(b'no database access',output)
                        self.assertIn(b'"news_list"',output)
                    if name=='long': self.assertIn(b'x'*1000,output)
                finally:
                    if process.poll() is None:
                        process.kill();process.wait()
                    os.close(master);os.close(slave)


if __name__=='__main__':
    unittest.main()
