# Public Disallowed-list certificates

Two certificates from Microsoft's public `disallowedcert.sst`, the certificate bundle behind the Windows Disallowed CTL.
The adapter test `the_runner_disallowed_ctl_names_public_disallowed_certificates_of_both_forms` matches them against
the runner's real `DisallowedCertEncodedCtl` registry value (design 4.2 item 2 and 9.2). They are public, distrusted
certificates with no private keys; they are only hashed, never trusted or installed.

Source: http://ctldl.windowsupdate.com/msdownload/update/v3/static/trustedr/en/disallowedcert.sst
(156041 bytes, SHA-256 `fb43750fe701e5a8355fb8c8e94f70f09e119755676442bcd8447a58f66ac948`, fetched 2026-10-27),
a serialized certificate store; each file is one certificate's DER, copied unchanged.

| File | Subject | Certificate SHA-1 | Certificate SHA-256 | CTL entry form | Entry |
| --- | --- | --- | --- | --- | --- |
| `microsoft-enforced-licensing-intermediate-pca.der` | Microsoft Enforced Licensing Intermediate PCA | `2A83E9020591A55FC6DDAD3FB102794C52B24E70` | `bb68fc508e3b21b35f26c586a81d728d5a33e3cea47c71132bf1d781911a9f3b` | 16 bytes, MD5 of the public key octets | `36cde99ab8737f86287c583704c95e16` |
| `darkmatter-assured-ca.der` | DarkMatter Assured CA | `9FEB091E053D1C453C789E8E9C446D31CB177ED9` | `d8888f4a84f74c974dffb573a1bf5bbbacd1713b905096f8eb015062bf396c4d` | 48 bytes, SHA-384 of the TBSCertificate | `4fc605c322f76f4d655179db89629f3928c36d92b63f609bdd58294387986e121482541b3fc246ab9bfdc1d6e4fef7a3` |

Both entries are in the public `disallowedcert.stl` snapshot (6704 bytes, SHA-256
`5ea4f4d3bdbff49d51e0795f8ea2a5f7508e08d863ebc2486cc2f10e896663d1`, sequence number `01dd5f6ca45c9d86`).
