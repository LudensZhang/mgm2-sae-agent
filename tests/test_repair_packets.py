"""Offline exporter helpers: no original data, files, credentials or model calls."""
import importlib.util
from pathlib import Path
import unittest
from collections import Counter

path=Path(__file__).resolve().parents[1]/'scripts/repair_packets.py'
spec=importlib.util.spec_from_file_location('repair_packets',path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class RepairPacketTests(unittest.TestCase):
    def test_tied_metadata_categories_have_reproducible_order_and_selection(self):
        a=Counter();b=Counter()
        for x in ['soil','plant','water']:a[x]=3
        for x in ['water','plant','soil']:b[x]=3
        self.assertEqual(module.distribution(a,3,2),module.distribution(b,3,2))
        self.assertEqual([r['category'] for r in module.distribution(a,3,2)['rows']],['plant','soil'])

    def test_public_accessions_are_not_limited_to_displayed_studies(self):
        private={'studies':['ERP022166','SRP211745','private_project'],'samples':['sample_1']}
        allowed=module.public_study_allowlist(private,{'ERP022166','SRP211745','private_project'},['SRP211745'])
        self.assertEqual(allowed,['ERP022166','SRP211745'])

    def test_public_looking_but_unverified_accession_rejected(self):
        with self.assertRaises(ValueError):
            module.public_study_allowlist({'studies':['ERP022166']},set(),['ERP022166'])

    def test_source_membership_required(self):
        with self.assertRaises(ValueError):
            module.public_study_allowlist({'studies':['ERP022166']},{'SRP211745'},['SRP211745'])

    def test_alias_replacement_preserves_samples_and_nonexact_strings(self):
        self.assertEqual(module.replace_aliases({'study':'STUDY_00001','sample':'SAMPLE_00001',
            'note':'part of STUDY_00001'}, {'STUDY_00001':'ERP022166'}),
            {'study':'ERP022166','sample':'SAMPLE_00001','note':'part of STUDY_00001'})

    def test_strict_controls_are_a_subset_not_new_matches(self):
        b={'diagnostics':{'analyses':{'matched_contrasts':{'joint':{'pairs':[
            {'positive':'a','same_study':True,'same_bin':True},
            {'positive':'b','same_study':True,'same_bin':False},
            {'positive':'c','same_study':False,'same_bin':True}]}}}}}
        r=module.strict_controls(b)['joint']
        self.assertEqual(r['strict_positive_event_ids'],['a'])
        self.assertEqual(r['relaxed_pairs'],2)


if __name__=='__main__':unittest.main()
