import copy
import json
import tempfile
import unittest
from pathlib import Path

import local_fallback as fallback
from options_revisions import OptionsPayload, OptionsRevisions
from test_local_options import NOW, iso, row
from test_local_fallback_permissions import assert_private_file


def gamma_pair():
    old = row()
    old["payload"].update(currentPrice=100, netGex=7_200_000_000, gammaFlip=99)
    new = OptionsPayload(copy.deepcopy(old["payload"]), iso(-40))
    new.update(fetchedAt=iso(0), currentPrice=101, netGex=8_400_000_000, gammaFlip=100)
    return old, new


class GammaRevisionTests(unittest.TestCase):
    def test_same_snapshot_newer_gamma_is_accepted_for_legacy_cache(self):
        old, new = gamma_pair()
        new["nextPollAfterMs"] = 901234
        self.assertEqual(fallback.options_decision(old, new, NOW), "update")

    def test_gamma_must_postdate_manual_observation_without_known_revision(self):
        old, new = gamma_pair()
        old["payload"]["fetchedAt"] = iso(-30)
        self.assertNotEqual(fallback.options_decision(old, new, NOW), "update")

    def test_later_fetch_clock_alone_does_not_make_equal_source_new(self):
        old, new = gamma_pair()
        for stamp in (iso(-60), iso(-55), None):
            new.gamma_updated_at = stamp
            self.assertNotEqual(fallback.options_decision(old, new, NOW), "update")

    def test_equal_snapshot_cannot_replace_changed_snapshot_values(self):
        old, new = gamma_pair()
        new["totalOptionVolume"] = 123
        self.assertNotEqual(fallback.options_decision(old, new, NOW), "update")

    def test_new_gamma_cannot_smuggle_an_older_snapshot(self):
        old, new = gamma_pair()
        new["sourceUpdatedAt"] = iso(-70)
        self.assertNotEqual(fallback.options_decision(old, new, NOW), "update")

    def test_identical_values_do_not_rewrite_cache(self):
        old, new = gamma_pair()
        new = OptionsPayload(copy.deepcopy(old["payload"]), iso(-40))
        new["fetchedAt"] = iso(0)
        new["nextPollAfterMs"] = 901234
        self.assertIn("unchanged", fallback.options_decision(old, new, NOW))

    def test_known_gamma_compares_source_revision_not_later_fetch_time(self):
        old, new = gamma_pair()
        old["payload"]["fetchedAt"] = old["fetched_at"] = iso(-25)
        # A delayed publication still contains a newer revision than our known
        # gamma source (-50), even though its revision predates our last fetch.
        self.assertEqual(fallback.options_decision(old, new, NOW, known_gamma=iso(-50)), "update")
        self.assertNotEqual(fallback.options_decision(old, new, NOW, known_gamma=iso(-40)), "update")
        self.assertNotEqual(fallback.options_decision(old, new, NOW, known_gamma=iso(-30)), "update")

    def test_new_snapshot_with_old_gamma_does_not_regress_gamma(self):
        old, new = gamma_pair()
        new["sourceUpdatedAt"] = iso(-5)
        new["asOf"] = iso(-6)
        self.assertNotEqual(fallback.options_decision(old, new, NOW, known_gamma=iso(-30)), "update")

    def test_snapshot_can_advance_price_without_claiming_new_gamma(self):
        old, new = gamma_pair()
        new["netGex"] = old["payload"]["netGex"]
        new["gammaFlip"] = old["payload"]["gammaFlip"]
        new["sourceUpdatedAt"] = iso(-5)
        new["asOf"] = iso(-6)
        self.assertEqual(fallback.options_decision(old, new, NOW, known_gamma=iso(-40)), "update")

    def test_future_gamma_is_rejected(self):
        old, new = gamma_pair()
        new.gamma_updated_at = iso(60)
        self.assertNotEqual(fallback.options_decision(old, new, NOW), "update")

    def test_revision_metadata_is_not_part_of_response_schema(self):
        _, new = gamma_pair()
        self.assertNotIn("gamma_updated_at", json.loads(json.dumps(new)))
        self.assertNotIn("gammaUpdatedAt", json.loads(json.dumps(new)))

    def test_local_provenance_invalidated_by_payload_only_manual_edit(self):
        old, new = gamma_pair()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "options-revisions.json"
            revisions = OptionsRevisions(path)
            revisions.remember(old, new)
            loaded = OptionsRevisions(path)
            self.assertEqual(loaded.matching_gamma(old), new.gamma_updated_at)
            altered = copy.deepcopy(old)
            altered["payload"]["netGex"] = 99
            self.assertIsNone(loaded.matching_gamma(altered))
            altered = copy.deepcopy(old)
            altered["fetched_at"] = iso(-3)
            self.assertIsNone(loaded.matching_gamma(altered))
            # Request-driven refresh gate activity does not change the data.
            old["last_attempted_at"] = iso(-1)
            self.assertEqual(loaded.matching_gamma(old), new.gamma_updated_at)
            assert_private_file(self, path)
            contents = json.loads(path.read_text())
            self.assertEqual(set(contents["SPY"]), {"row_digest", "gamma_updated_at"})

    def test_missing_or_corrupt_local_metadata_fails_closed(self):
        old, new = gamma_pair()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.json"
            self.assertIsNone(OptionsRevisions(path).matching_gamma(old))
            path.write_text("not json")
            self.assertIsNone(OptionsRevisions(path).matching_gamma(old))

    def test_external_edit_cannot_be_overwritten_by_gamma_only_revision(self):
        old, new = gamma_pair()
        self.assertNotEqual(fallback.options_decision(
            old, new, NOW, gamma_cache_changed=True), "update")


if __name__ == "__main__":
    unittest.main()
