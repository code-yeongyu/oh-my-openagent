use super::run::{encode_token, parse_args, Spawner};
use super::wire::TOKEN_LEN;

fn args(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_owned()).collect()
}

#[test]
fn the_helper_takes_exactly_its_parent_and_spawn_token() {
    let token: [u8; TOKEN_LEN] = [0, 1, 2, 0xab, 0xff, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0x10, 0xfe];
    let hex = encode_token(&token);
    assert_eq!(hex, "000102abff09080706050403020110fe");
    assert_eq!(parse_args(&args(&["--parent", "4242", "--token", &hex])), Ok(Spawner { parent: 4242, token }));
}

#[test]
fn the_helper_refuses_any_other_argv() {
    let hex = encode_token(&[7; TOKEN_LEN]);
    for refused in [
        args(&[]),
        args(&["--parent", "4242"]),
        args(&["--token", &hex, "--parent", "4242"]),
        args(&["--parent", "pid", "--token", &hex]),
        args(&["--parent", "4242", "--token", &hex[2..]]),
        args(&["--parent", "4242", "--token", &hex.replace('0', "g")]),
        args(&["--parent", "4242", "--token", &hex, "--extra"]),
    ] {
        let refusal = parse_args(&refused).expect_err("refused");
        assert!(refusal.starts_with("refusing to run"), "{refused:?}: {refusal}");
    }
}
