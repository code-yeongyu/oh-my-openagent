### Changed

- thread: a host that does not authenticate is still served in this release, and is refused with `host_unauthenticated` from the next one. Engines older than 2026.10.24-3 publish no key record, so they fall into this case. To prepare: `omo update`, then `omo daemon stop`, then any thread call. Windows named pipes do not yet prove the host's identity (code-yeongyu/senpi#7571). See "Hosts that do not authenticate" in the `omo thread` reference ([#15222](https://github.com/code-yeongyu/oh-my-openagent/issues/15222)).
